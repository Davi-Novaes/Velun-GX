import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { AccountApiError, type AccountProfile } from "../api/accounts";
import {
  communities as api,
  type Channel,
  type ChannelPresence,
  type InviteEntry,
  type Server,
  type ServerDetails,
  type Snapshot,
  type Member,
} from "../api/communities";
import { useServices } from "../app/services";
import { LiveKitRoomClient, type StreamDiagnostic } from "../media/LiveKitRoomClient";
import { StreamAudio, StreamContext, type AudioPreference } from "../features/workspace/StreamContext";
import { Icon } from "../features/workspace/Icons";
import {
  ShareError,
  type ConnectionPhase,
  type LocalShare,
  type ParticipantView,
  type ShareOptions,
  type ShareView,
} from "../media/RoomClient";
import { StreamStage } from "../features/workspace/StreamGrid";
import type { ViewMode } from "../features/workspace/stageLayout";
import "../styles/workspace.css";
import "../styles/redesign.css";
import { Diagnostics } from "../features/workspace/Diagnostics";
import { networkLevel } from "../features/workspace/network";
import { IconPicker } from "../features/workspace/IconPicker";

import { AppVersion, DownloadApp } from "../features/desktop/DownloadApp";
import { NicknameForm } from "../features/workspace/NicknameForm";
import { PasswordForm } from "../features/workspace/PasswordForm";
import { useCallSounds } from "../features/workspace/useCallSounds";
import { checkDesktopAudio, desktopProcessAudio, mutesOtherStreams, pcAudioAllowed, setPcAudioAllowed, velunBridge } from "../desktop/velun";
import { WINDOWS10_AUDIO } from "../media/LiveKitScreenShare";
import { h264HardwareKnown, hardwareEncodingPreferred, runEncoderBenchmark, setHardwareEncodingPreferred } from "../media/codecChoice";
import { audioKeys, loadAudioMemory, rememberAudio, rememberedAudio, saveAudioMemory } from "../features/workspace/audioMemory";
import { detectShareCapabilities } from "../media/capabilities";
import { SoundSettings } from "../features/workspace/SoundSettings";
import { QualityFields, loadQualityChoice, saveQualityChoice } from "../features/workspace/QualityFields";
import { MembersPanel, MemberMenu, PERMISSIONS, permissionsFor, canModerate, memberRole } from "../features/workspace/CommunityControls";
import "../styles/community.css";
import "../styles/settings.css";
import "../styles/stage.css";
import { ServerSettings, type SettingsTab } from "../features/workspace/ServerSettings";

type Dialog =
  | "server"
  | "manage"
  | "channel"
  | "invite"
  | "share"
  | "quality"
  | "account"
  | "diagnostics"
  | "roles"
  | null;
const initialQuality: ShareOptions = {
  resolution: "1080p",
  fps: 30,
  surface: "any",
  audio: true,
  audioScope: "shared",
};
const messages: Record<ConnectionPhase, string> = {
  connecting: "Conectando…",
  verifying: "Verificando conexão…",
  connected: "Conectado",
  reconnecting: "Reconectando…",
  disconnected: "Desconectado",
};

export function WorkspacePage() {
  const { accounts } = useServices();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsTab = searchParams.get("settings") as SettingsTab | null;
  const setSettingsTab = (tab: SettingsTab | null) => { setSearchParams((current) => { const params = new URLSearchParams(current); if (tab) params.set("settings", tab); else params.delete("settings"); return params; }, { replace: true }); };
  const { serverId } = useParams();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [details, setDetails] = useState<ServerDetails | null>(null);
  const [presence, setPresence] = useState<ChannelPresence[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);
  const channelRef = useRef<string | null>(null);
  const switching = useRef(false);
  const restoredServer = useRef<string | null>(null);
  const rememberedKey = useRef<string | null>(null);
  const mounted = useRef(true);
  const [client] = useState(
    () =>
      new LiveKitRoomClient({
        authorize: async () => {
          if (!channelRef.current)
            throw new Error("Entre em um canal primeiro.");
          await api.publish(channelRef.current, true);
        },
        release: async () => {
          if (channelRef.current) await api.publish(channelRef.current, false);
        },
      }),
  );
  const [phase, setPhase] = useState<ConnectionPhase>("disconnected");
  const [samples, setSamples] = useState<StreamDiagnostic[]>([]);
  // volume/mudo de cada pessoa, lembrado neste navegador (ver audioMemory.ts)
  const [audioMemory, setAudioMemory] = useState(loadAudioMemory);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [appPing, setAppPing] = useState<number | undefined>();
  const shareKeys = useRef<(id: string) => string[]>(() => []);
  const changeAudio = useCallback((id: string, patch: Partial<AudioPreference>) => setAudioMemory((old) => { const next = rememberAudio(old, shareKeys.current(id), patch); saveAudioMemory(next); return next; }), []);
  useEffect(() => {
    if (phase !== 'connected') { setSamples([]); return; }
    let active = true, pending = false;
    const collect = async () => { if (pending) return; pending = true; try { const value = await client.diagnostics(); if (active) setSamples(value); } catch { if (active) setSamples([]); } finally { pending = false; } };
    void collect(); const timer = setInterval(() => void collect(), 2000);
    return () => { active = false; clearInterval(timer); };
  }, [client, phase]);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [shares, setShares] = useState<ShareView[]>([]);
  const [local, setLocal] = useState<LocalShare | null>(null);
  useCallSounds(phase, participants, shares);
  // app no Windows 10? (sem captura por programa) — verificado antes de qualquer clique em compartilhar
  useEffect(() => checkDesktopAudio(), []);
  const [pcAudio, setPcAudio] = useState(pcAudioAllowed);
  const [hardwareEncoding, setHardwareEncoding] = useState(hardwareEncodingPreferred);
  const [quality, setQuality] = useState<ShareOptions>(() => loadQualityChoice(initialQuality));
  const [hidden, setHidden] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  // Palco: viewMode = grid | focus; no destaque, focusedStreamId é a transmissão principal.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  // teste do processador (~1 s) enquanto a pessoa escolhe a fonte: decide entre VP9 e VP8 sem atrasar o clique
  useEffect(() => { if (dialog === "share") void runEncoderBenchmark(); }, [dialog]);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [invites, setInvites] = useState<InviteEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [presenceState, setPresenceState] = useState("Conectando presença…");
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [copied, setCopied] = useState(false);
  const owner = details?.ownerUserId === profile?.id;
  const rights = permissionsFor(details, profile?.id);
  const [showMembers, setShowMembers] = useState(false);
  const [memberMenu, setMemberMenu] = useState<Member | null>(null);
  const [dropChannel, setDropChannel] = useState<string | null>(null);
  const moderationJoin = useRef<(id: string | null) => Promise<void>>(async () => {});

  const fail = useCallback(
    (e: unknown) => {
      if (!mounted.current) return;
      if (e instanceof ShareError && e.kind === "cancelled") return;
      if (e instanceof AccountApiError && e.status === 401) {
        void client.disconnect();
        navigate("/login", { replace: true });
        return;
      }
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível concluir. Tente novamente.",
      );
    },
    [client, navigate],
  );
  const refresh = useCallback(async () => {
    const list = await api.list();
    if (mounted.current) setServers(list);
    if (serverId) {
      const d = await api.details(serverId);
      if (mounted.current) setDetails(d);
    }
  }, [serverId]);
  const exit = useCallback(async () => {
    const old = channelRef.current;
    if (rememberedKey.current) { try { sessionStorage.removeItem(rememberedKey.current); } catch { /* storage pode estar bloqueado */ } rememberedKey.current = null; }
    await client.disconnect();
    channelRef.current = null;
    setSelected(null);
    setParticipants([]);
    setShares([]);
    setLocal(null);
    setFocusedStreamId(null);
    if (old) await api.exit(old).catch(() => undefined);
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    const off = [
      client.on("phaseChanged", (p, cause) => {
        setPhase(p);
        if (p === "disconnected" && cause !== "left")
          setError(
            cause === "replaced"
              ? "Sua conta entrou em outra aba. Reconecte para usar esta."
              : cause === "removed" || cause === "room_closed"
                ? "Você foi desconectado deste canal."
                : "A conexão com o canal caiu. Tente novamente.",
          );
      }),
      client.on("participantsChanged", setParticipants),
      client.on("sharesChanged", setShares),
      client.on("localShareChanged", setLocal),
      client.on("audioPlaybackChanged", setAudioBlocked),
    ];
    return () => {
      mounted.current = false;
      off.forEach((f) => f());
      void client.disconnect();
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    void accounts.me().then((p) => {
      if (!active) return;
      // senha provisória do administrador: cria a própria senha antes de entrar nos servidores
      if (p.mustChangePassword) { navigate("/account", { replace: true }); return; }
      setProfile(p);
    }, fail);
    return () => {
      active = false;
    };
  }, [accounts, fail, navigate]);
  // Login encerrado em outro lugar (saiu em outro dispositivo, conta banida): volta para a entrada mesmo
  // sem servidor aberto (dentro de um servidor, a presença já avisa na hora).
  useEffect(() => {
    if (!profile) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void accounts.me().catch((e: unknown) => {
        if (e instanceof AccountApiError && e.status === 401) fail(e);
      });
    }, 20000);
    return () => clearInterval(timer);
  }, [profile, accounts, fail]);
  useEffect(() => {
    if (!profile) return;
    let active = true;
    void api.list().then((list) => {
      if (!active) return;
      setServers(list);
      if (!serverId && list.length)
        navigate(`/app/${list[0]!.id}`, { replace: true });
    }, fail);
    return () => {
      active = false;
    };
  }, [profile, serverId, navigate, fail]);

  useEffect(() => {
    if (!profile || !serverId) {
      setDetails(null);
      return;
    }
    let active = true;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setDetails(null);
    setPresence([]);
    setPresenceState("Conectando presença…");
    const hub = new HubConnectionBuilder()
      .withUrl("/api/v1/presence")
      .withAutomaticReconnect([0, 2000, 5000, 10000, 20000])
      .configureLogging(LogLevel.Error)
      .build();
    const apply = (snapshot: Snapshot) => {
      if (!active || snapshot.serverId !== serverId) return;
      setDetails(snapshot.details);
      setSelected((old) => old ? snapshot.details.channels.find((c) => c.id === old.id) ?? null : null);
      setPresence(snapshot.channels);
      setServers((previous) =>
        previous.map((s) =>
          s.id === serverId
            ? {
                ...s,
                name: snapshot.details.name,
                icon: snapshot.details.icon,
                memberCount: snapshot.details.members.length,
              }
            : s,
        ),
      );
      if (
        channelRef.current &&
        !snapshot.details.channels.some((c) => c.id === channelRef.current)
      )
        void exit();
    };
    hub.on("Snapshot", apply);
    hub.on("MemberMoved", (id: string, channel: string | null) => { if (active && id === serverId && channelRef.current) void moderationJoin.current(channel); });
    hub.on(
      "Presence",
      (snapshot: { serverId: string; channels: ChannelPresence[] }) => {
        if (active && snapshot.serverId === serverId)
          setPresence(snapshot.channels);
      },
    );
    // Presença expirada (heartbeat atrasado por pausa do servidor ou rede) não é perda de acesso:
    // registra de novo em silêncio, sem tirar ninguém da chamada.
    hub.on("PresenceExpired", () => {
      if (active && hub.state === "Connected") void hub.invoke("Watch", serverId).catch(() => undefined);
    });
    hub.on("AccessRemoved", (_server: string, reason?: string) => {
      if (active) {
        void exit();
        setError(
          reason === "session"
            ? "Sua sessão foi encerrada (você saiu da conta neste ou em outro dispositivo). Entre novamente."
            : reason === "membership"
              ? "Você não faz mais parte deste servidor."
              : reason === "server_deleted"
                ? "Este servidor foi excluído."
                : "Seu acesso a este servidor foi encerrado.",
        );
        navigate("/app", { replace: true });
      }
    });
    hub.onreconnecting(() => {
      if (active) setPresenceState("Reconectando presença…");
    });
    hub.onreconnected(async () => {
      if (active) {
        await hub.invoke("Watch", serverId);
        setPresenceState("");
      }
    });
    const start = async () => {
      try {
        await hub.start();
        if (!active) {
          await hub.stop();
          return;
        }
        await hub.invoke("Watch", serverId);
        setPresenceState("");
      } catch {
        if (active) {
          setPresenceState("Presença indisponível. Tentando reconectar…");
          retry = setTimeout(() => void start(), 5000);
        }
      }
    };
    hub.onclose(() => {
      if (active) {
        setPresenceState("Reconectando presença…");
        retry = setTimeout(() => void start(), 5000);
      }
    });
    void api.details(serverId).then(
      (d) => {
        if (active) setDetails(d);
      },
      (e) => {
        if (active) {
          fail(e);
          navigate("/app", { replace: true });
        }
      },
    );
    void start();
    heartbeat = setInterval(() => {
      if (hub.state === "Connected") {
        const started = performance.now();
        void hub.invoke("Ping").then(() => { if (active) { const ms = performance.now() - started; setAppPing(ms); client.setSignalingPing(ms); } }).catch(() => { if (active) setAppPing(undefined); });
        void hub.invoke("Heartbeat").catch(() => undefined);
      }
    }, 5000);
    return () => {
      active = false;
      clearInterval(heartbeat);
      clearTimeout(retry);
      void hub.stop();
    };
  }, [profile, serverId, navigate, fail, exit]);

  const watched = shares.filter(
    (s) => !s.isLocal && !paused && !hidden.includes(s.id),
  );
  // sua transmissão participa do palco como qualquer outra (miniatura "(Você)" no destaque)
  const visible = [...watched, ...shares.filter((s) => s.isLocal)];
  const watchedIds = watched
    .map((s) => s.id)
    .sort()
    .join(",");
  useEffect(() => {
    client.setWatchingShares(watchedIds ? watchedIds.split(",") : []);
  }, [client, watchedIds]);
  const visibleIds = visible.map((s) => s.id).join(",");
  useEffect(() => {
    // a transmissão em destaque saiu: outra assume (de preferência de outra pessoa); sem nenhuma, volta à grade
    if (viewMode !== "focus" || (focusedStreamId && visibleIds.split(",").includes(focusedStreamId))) return;
    const next = visibleIds ? visibleIds.split(",")[0]! : null;
    setFocusedStreamId(next);
    if (!next) setViewMode("grid");
  }, [viewMode, focusedStreamId, visibleIds]);
  const focusStream = useCallback((id: string) => { setFocusedStreamId(id); setViewMode("focus"); }, []);

  async function join(channel: Channel) {
    if (
      switching.current ||
      (channelRef.current === channel.id && phase === "connected")
    )
      return;
    switching.current = true;
    setBusy(true);
    setError("");
    try {
      await exit();
      const response = await api.join(channel.id);
      if (!mounted.current) { await api.exit(channel.id).catch(() => undefined); return; }
      channelRef.current = channel.id;
      setSelected(channel);
      setHidden([]);
      setPaused(false);
      await client.connect(response);
      if (profile && serverId) { rememberedKey.current = `tj:channel:${profile.id}:${serverId}`; try { sessionStorage.setItem(rememberedKey.current, channel.id); } catch { /* reconexão continua sem storage */ } }
      if (serverId) setPresence(await api.presence(serverId));
      setMobileSidebar(false);
    } catch (e) {
      fail(e);
    } finally {
      switching.current = false;
      setBusy(false);
    }
  }
  async function selectServer(id: string) {
    if (id === serverId || busy || switching.current) return;
    await exit();
    setError("");
    navigate(`/app/${id}`);
  }
  moderationJoin.current = async (id) => {
    if (!id) { await exit(); setError('Você foi desconectado do canal por um moderador.'); return; }
    try { const current = await api.details(serverId!); const channel = current.channels.find((c) => c.id === id); if (channel) { await join(channel); setError('Você foi movido para este canal por um moderador.'); } } catch (e) { fail(e); }
  };
  async function watchFromChannel(id: string, identity: string) {
    const channel = details?.channels.find((c) => c.id === id);
    if (!channel) return;
    if (channelRef.current !== id || phase !== 'connected') await join(channel);
    if (channelRef.current === id) { watch(identity); focusStream(identity); setMobileSidebar(false); }
  }
  async function dropMember(e: React.DragEvent, channel: Channel) {
    e.preventDefault(); setDropChannel(null);
    const userId = e.dataTransfer.getData('application/x-velun-member');
    if (!details || !profile || !userId || !(rights & PERMISSIONS.move) || !canModerate(details, profile.id, userId)) return;
    await perform(async () => { await api.move(details.id, userId, channel.id); });
  }
  useEffect(() => {
    if (!profile || !details || restoredServer.current === details.id) return;
    restoredServer.current = details.id;
    try {
      const id = sessionStorage.getItem(`tj:channel:${profile.id}:${details.id}`);
      const channel = details.channels.find((c) => c.id === id);
      if (channel) void join(channel);
    } catch { /* storage opcional: o usuário pode entrar pelo clique */ }
  }, [profile, details]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function open(kind: Dialog, value = "") {
    if (kind === "manage" || kind === "roles") { setSettingsTab(kind === "roles" ? "roles" : "general"); return; }
    setName(value);
    setDialog(kind);
    setError("");
    setConfirmDelete(false);
    setInviteLink("");
    setCopied(false);
    setIcon(null);
  }
  async function createServer(e: React.FormEvent) {
    e.preventDefault();
    await perform(async () => {
      const server = await api.create(name.trim(), icon);
      await exit();
      setServers(await api.list());
      setDialog(null);
      navigate(`/app/${server.id}`);
    });
  }
  async function acceptInvite() {
    await perform(async () => {
      const code = inviteCode.trim().split("/invite/").pop()!.split(/[?#]/)[0]!;
      const result = await api.accept(code);
      await exit();
      setServers(await api.list());
      setDialog(null);
      navigate(`/app/${result.serverId}`);
    });
  }
  async function saveChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!details) return;
    await perform(async () => {
      if (editingChannel)
        await api.renameChannel(editingChannel.id, name.trim());
      else await api.createChannel(details.id, name.trim());
      await refresh();
      setDialog(null);
    });
  }
  async function move(channel: Channel, delta: number) {
    if (!details) return;
    const ids = details.channels.map((c) => c.id);
    const index = ids.indexOf(channel.id);
    const other = index + delta;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    await perform(async () => {
      await api.reorder(details.id, ids);
      await refresh();
    });
  }
  async function applyQuality(surface?: ShareOptions["surface"]) {
    // Captura nativa é chamada diretamente no clique; nenhuma chamada HTTP a precede.
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      saveQualityChoice(quality);
      if (local) await client.updateQuality(quality);
      else { const options = { ...quality, surface: surface ?? quality.surface, audio: true, audioScope: "shared" as const, hardwareEncoding }; setQuality(options); await client.startScreenShare(options); }
      setDialog(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function hide(id: string) {
    setHidden((list) => [...new Set([...list, id])]);
  }
  function watch(id: string) {
    if (paused)
      setHidden(
        shares.filter((s) => !s.isLocal && s.id !== id).map((s) => s.id),
      );
    else setHidden((list) => list.filter((x) => x !== id));
    setPaused(false);
  }
  const ownerActions = { quality: () => open("quality"), source: () => { void perform(async () => { await client.switchSource(quality); }); }, stop: () => { void perform(() => client.stopScreenShare()); }, state: local };
  // quem é a conta por trás de cada transmissão (a sessão muda a cada entrada; a conta não)
  const ownerAccount = new Map(presence.flatMap((c) => c.participants.map((p) => [p.identity, p.userId] as const)));
  shareKeys.current = (id) => audioKeys(ownerAccount.get(id), shares.find((s) => s.id === id)?.ownerName ?? id);
  const audioPreferences: Record<string, AudioPreference> = {};
  for (const s of shares) {
    const remembered = s.isLocal ? undefined : rememberedAudio(audioMemory, shareKeys.current(s.id));
    if (remembered) audioPreferences[s.id] = remembered;
  }
  const present =
    presence.find((c) => c.id === selected?.id)?.participants ?? [];
  const activeCount =
    selected && phase === "connected" ? participants.length : present.length;

  return (
    <StreamContext.Provider value={{ samples, audio: audioPreferences, changeAudio }}>
      {settingsTab && details && profile && <ServerSettings key={details.id} details={details} actor={profile.id} presence={presence} tab={settingsTab} selectTab={setSettingsTab} close={() => setSettingsTab(null)} refresh={refresh}
        removed={async () => { await exit(); setSettingsTab(null); navigate("/app", { replace: true }); }}
        editChannel={(id) => { const channel = details.channels.find((c) => c.id === id); setEditingChannel(channel ?? null); setSettingsTab(null); open("channel", channel?.name ?? ""); }}
        invite={() => { setSettingsTab(null); open("invite"); if (rights & PERMISSIONS.invite) void api.invites(details.id).then(setInvites, fail); }} />}

    <main className={`workspace${mobileSidebar ? " sidebar-open" : ""}${showMembers ? " members-open" : ""}`}>
      {watched.filter((s) => s.hasAudio).map((s) => <StreamAudio key={s.id} share={s} client={client} />)}
      <nav className="server-rail" aria-label="Servidores">
        <Link className="rail-brand" to="/app" title="Velun Gx">
          <Icon name="monitor" size={25} />
          <span />
        </Link>
        <div className="rail-divider" />
        {servers.map((s) => (
          <button
            key={s.id}
            className={`server-icon${s.id === serverId ? " active" : ""}`}
            title={s.name}
            aria-label={`Servidor ${s.name}`}
            onClick={() => void selectServer(s.id)}
            disabled={busy}
          >
            {s.icon ? <img src={s.icon} alt="" /> : s.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
        <button
          className="server-icon add-server"
          aria-label="Adicionar servidor"
          title="Adicionar servidor"
          onClick={() => open("server")}
        >
          <Icon name="plus" size={23} />
        </button>
      </nav>
      {mobileSidebar && <button className="sidebar-scrim" aria-label="Fechar canais" onClick={() => setMobileSidebar(false)} />}
      <aside className="channel-sidebar" aria-label="Canais e participantes">
        <header className="server-heading">
          <button
            onClick={() => details && open("manage", details.name)}
            disabled={!details}
          >
            <span>{details?.name ?? "Seus espaços"}</span>
            <span>⌄</span>
          </button>
        </header>
        <div className="channel-scroll">
          <div className="sidebar-label">
            CANAIS DE TRANSMISSÃO
            {!!(rights & PERMISSIONS.channels) && (
              <button
                aria-label="Criar canal"
                title="Criar canal"
                onClick={() => {
                  setEditingChannel(null);
                  open("channel");
                }}
              >
                +
              </button>
            )}
          </div>
          {details?.channels.map((c) => (
            <div key={c.id} className={`channel-row${dropChannel === c.id ? ' drop-target' : ''}`} onDragOver={(e) => { if (rights & PERMISSIONS.move) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropChannel(c.id); } }} onDragLeave={() => setDropChannel(null)} onDrop={(e) => void dropMember(e, c)}>
              <button
                className={`channel-link${selected?.id === c.id ? " selected" : ""}`}
                onClick={() => void join(c)}
                disabled={busy}
              >
                <span className="channel-hash">#</span>
                <span className="channel-title">{c.name}</span>
                <small>
                  {presence.find((p) => p.id === c.id)?.participants.length ||
                    ""}
                </small>
              </button>
              {!!(rights & PERMISSIONS.channels) && (
                <button
                  className="channel-edit"
                  aria-label={`Configurar canal ${c.name}`}
                  onClick={() => {
                    setEditingChannel(c);
                    open("channel", c.name);
                  }}
                >
                  ⋯
                </button>
              )}
              {/* quem está no canal, mesmo sem você estar dentro (no seu canal, a lista completa fica em "Participantes") */}
              {(presence.find((p) => p.id === c.id)?.participants.length ?? 0) > 0 && (
                <ul className="channel-members" aria-label={`Conectados em ${c.name}`}>
                  {presence.find((p) => p.id === c.id)!.participants.map((m) => (
                    <li key={m.identity} draggable={!!profile && !!(rights & PERMISSIONS.move) && canModerate(details!, profile.id, m.userId)} onDragStart={(e) => { e.dataTransfer.setData('application/x-velun-member', m.userId); e.dataTransfer.effectAllowed = 'move'; }} onContextMenu={(e) => { e.preventDefault(); const member = details?.members.find((p) => p.id === m.userId); if (member) setMemberMenu(member); }}>
                      <span className="channel-member-avatar" aria-hidden="true">{m.name.trim().slice(0, 2).toUpperCase()}</span>
                      <button className="channel-member-name" style={{ color: details ? memberRole(details, details.members.find((p) => p.id === m.userId))?.color : undefined }} onClick={() => { const member = details?.members.find((p) => p.id === m.userId); if (member) setMemberMenu(member); }}>{m.name}</button>
                      {m.isSharing && <button className="channel-member-live" aria-label={`Assistir ao vivo ${m.name}`} onClick={() => void watchFromChannel(c.id, m.identity)}>AO VIVO</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {details && !details.channels.length && (
            <p className="sidebar-empty">Nenhum canal criado.</p>
          )}
          <div className="sidebar-label participants-label">
            PARTICIPANTES <span>{selected ? `${activeCount}/20` : "—"}</span>
          </div>
          {selected ? (
            participants.map((p) => (
              <div key={p.identity} className="compact-participant">
                <span
                  className={`presence-dot${p.isSharing ? " live" : p.connection === "reconnecting" ? " reconnecting" : ""}`}
                />
                <div>
                  <span>
                    {p.name}
                    {p.isLocal && <small> você</small>}
                  </span>
                  <small>
                    {p.connection === "reconnecting"
                      ? "Reconectando"
                      : p.isSharing
                        ? "Transmitindo"
                        : "Online"}
                  </small>
                </div>
                {p.isSharing && !p.isLocal && (
                  <button
                    title={
                      paused || hidden.includes(p.identity)
                        ? "Assistir"
                        : "Parar de assistir"
                    }
                    aria-label={`${paused || hidden.includes(p.identity) ? "Assistir" : "Ocultar"} ${p.name}`}
                    onClick={() =>
                      paused || hidden.includes(p.identity)
                        ? watch(p.identity)
                        : hide(p.identity)
                    }
                  >
                    {paused || hidden.includes(p.identity) ? "▷" : "−"}
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="sidebar-empty">Escolha um canal para entrar.</p>
          )}
          {details && (
            <button
              className="invite-shortcut"
              onClick={() => {
                open("invite");
                if (rights & PERMISSIONS.invite) void api.invites(details.id).then(setInvites, fail);
              }}
              disabled={!(rights & PERMISSIONS.invite)}
              title={
                owner
                  ? "Convidar amigos"
                  : "Solicite um convite ao proprietário"
              }
            >
              ↗ Convidar amigos
            </button>
          )}
          {details && <div className="sidebar-tools"><button onClick={() => setShowMembers(!showMembers)}><Icon name="users" />Membros <span>{details.members.length}</span></button><button onClick={() => open('manage')}><Icon name="settings" />Configurações do servidor</button></div>}
        </div>
        {selected && (
          <div className="channel-connection">
            <span
              className={`presence-dot${phase !== "connected" ? " reconnecting" : ""}`}
            />
            <div>
              <strong>{messages[phase]}</strong>
              <small>#{selected.name}</small>
              <small className={`connection-ping net-${networkLevel(appPing, undefined)}`}><Icon name="signal" size={12} /> {appPing === undefined ? 'Medindo ping…' : `${Math.round(appPing)} ms`}</small>
            </div>
            <button
              aria-label="Sair do canal"
              title="Sair do canal"
              onClick={() => void perform(exit)}
            >
              ⏻
            </button>
          </div>
        )}
        <footer className="user-panel">
          <span className="user-avatar">
            {profile?.name.slice(0, 2).toUpperCase() ?? "…"}
          </span>
          <div>
            <strong>{profile?.name ?? "Conectando"}</strong>
            <small>{local ? "Transmitindo tela" : "Disponível"}</small>
          </div>
          <DownloadApp compact />
          <button
            aria-label="Configurações da conta"
            title="Configurações da conta"
            onClick={() => open("account")}
          >
            ⚙
          </button>
        </footer>
      </aside>
      <section className="workspace-main">
        <header className="workspace-header">
          <button
            className="sidebar-toggle"
            aria-label="Mostrar canais"
            onClick={() => setMobileSidebar(!mobileSidebar)}
          >
            <Icon name="menu" />
          </button>
          <span className="channel-hash"><Icon name="monitor" size={22} /></span>
          <h1>{selected?.name ?? details?.name ?? "Bem-vindo"}</h1>
          <span className="header-separator" />
          <p>
            {selected
              ? "Telas ao vivo. Sua turma por perto."
              : "Um espaço para compartilhar."}
          </p>
          <button className={`header-status net-${networkLevel(appPing, undefined)}`} title="Ping de sinalização da sua conexão. Abrir diagnóstico de mídia." onClick={() => open("diagnostics")}>
            <span
              className={`presence-dot${selected && phase !== "connected" ? " reconnecting" : ""}`}
            />
            {selected ? messages[phase] : "Online"}
          </button>
          {details && <button className={`members-toggle${showMembers ? ' selected' : ''}`} aria-label="Mostrar membros do servidor" aria-pressed={showMembers} onClick={() => setShowMembers(!showMembers)}><Icon name="users" /><span>{details.members.length}</span></button>}
        </header>
        {mutesOtherStreams(local?.desktopAudio) && local?.audioEnabled && <div className="workspace-notice" role="status"><Icon name="volume" /><span>{local?.desktopAudio === "system-loopback" ? "Transmitindo todo o som do PC (inclui a call do Discord). O som das outras transmissões fica mudo para você enquanto isso, senão voltaria para a sala como eco." : "O som das outras transmissões fica pausado enquanto você transmite, para evitar eco."}</span></div>}
        {local?.audioRequested && !local.hasAudio && local.audioError && <div className="workspace-notice" role="status"><Icon name="mute" /><span>Transmitindo sem som: {local.audioError}</span>{local.audioError === WINDOWS10_AUDIO && <button className="btn" disabled={busy} onClick={() => { setPcAudioAllowed(true); setPcAudio(true); void perform(async () => { await client.switchSource(quality); }); }}>Ativar som do PC</button>}</div>}
        {audioBlocked && watched.some((s) => s.hasAudio) && <div className="workspace-notice audio-unlock"><Icon name="volume" /><span>O navegador está aguardando sua permissão para tocar o som.</span><button className="btn" onClick={() => void client.startAudio().catch(fail)}>Ativar áudio</button></div>}
        {presenceState && serverId && (
          <div className="workspace-notice" role="status">
            {presenceState}
          </div>
        )}
        {error && (
          <div className="workspace-error" role="alert">
            <span>{error}</span>
            <button aria-label="Fechar aviso" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <div className="stage-toolbar">
          <span className="stage-label"><span className="stage-live-mark" />
            {visible.length
              ? `${visible.length} ${visible.length === 1 ? "transmissão" : "transmissões"}`
              : selected
                ? "Canal de transmissão"
                : "Seus servidores"}
          </span>
          <div className="view-controls">
            <div className="view-segment" role="group" aria-label="Modo de visualização">
              <button aria-label={viewMode === 'focus' ? 'Voltar para grade' : 'Visualização em grade'} aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')}><Icon name="grid" size={16} /><span>Grade</span></button>
              <button aria-label="Visualização em destaque" aria-pressed={viewMode === 'focus'} disabled={!visible.length} onClick={() => focusStream(visible.some((s) => s.id === focusedStreamId) ? focusedStreamId! : visible[0]!.id)}><Icon name="focus" size={17} /><span>Destaque</span></button>
            </div>
            {shares.some((s) => !s.isLocal) && (
              // Um botão só: assistindo tudo → oferece "Não assistir"; com algo oculto → oferece "Ver todas".
              // Considera só transmissões que existem agora (quem foi ocultado e saiu do canal não conta).
              !paused && !shares.some((s) => !s.isLocal && hidden.includes(s.id)) ? (
                <button
                  className="view-action"
                  aria-label="Não assistir"
                  title="Parar de receber todas as transmissões (economiza internet)"
                  onClick={() => {
                    setPaused(true);
                  }}
                >
                  <Icon name="eyeOff" size={17} /><span>Não assistir</span>
                </button>
              ) : (
                <button
                  className="view-action selected"
                  aria-label="Ver todas"
                  title="Voltar a assistir todas as transmissões"
                  onClick={() => {
                    setPaused(false);
                    setHidden([]);
                  }}
                >
                  <Icon name="eye" size={17} /><span>Ver todas</span>
                </button>
              )
            )}
          </div>
        </div>
        <div className="workspace-stage">
          {visible.length ? (
            <StreamStage
              streams={visible}
              viewMode={viewMode}
              focusedStreamId={focusedStreamId}
              onFocus={focusStream}
              client={client}
              hide={hide}
              ownerActions={ownerActions}
            />
          ) : (
            <div className="workspace-empty">
              <div className="empty-symbol">
                <Icon name="monitor" size={40} /><span />
              </div>
              <span className="eyebrow">
                {selected ? "JUNTOS, EM TEMPO REAL" : "SEU PONTO DE ENCONTRO"}
              </span>
              <h2>
                {selected
                  ? shares.some((s) => !s.isLocal)
                    ? "Você está só de passagem."
                    : "O palco é de vocês."
                  : details
                    ? "Escolha um canal."
                    : "Crie seu primeiro espaço."}
              </h2>
              <p>
                {selected
                  ? shares.some((s) => !s.isLocal)
                    ? "As transmissões estão ocultas. Assista quando quiser."
                    : "Compartilhe sua tela ou espere seus amigos começarem."
                  : details
                    ? "Entre para encontrar sua turma e suas transmissões."
                    : "Um servidor reúne seus amigos e canais em um só lugar."}
              </p>
              {!details && (
                <button
                  className="btn btn-primary"
                  onClick={() => open("server")}
                >
                  Adicionar servidor
                </button>
              )}
              {selected && phase === "disconnected" && (
                <button
                  className="btn btn-primary"
                  onClick={() => void join(selected)}
                >
                  Tentar reconectar
                </button>
              )}
            </div>
          )}
        </div>
        {(hidden.length > 0 || paused) && shares.some((s) => !s.isLocal) && (
          <div className="hidden-streams">
            {shares
              .filter((s) => !s.isLocal && (paused || hidden.includes(s.id)))
              .map((s) => (
                <button key={s.id} onClick={() => watch(s.id)}>
                  ▷ Assistir {s.ownerName}
                </button>
              ))}
          </div>
        )}
        <footer className="workspace-controls">
          <div>
            <button className={`footer-ping net-${networkLevel(appPing, undefined)}`} title="Seu ping de sinalização. Abrir diagnóstico." onClick={() => open('diagnostics')}><Icon name="signal" size={14} />{appPing === undefined ? 'Medindo ping…' : `${Math.round(appPing)} ms`}</button>
            <span className="control-caption">
              {selected
                ? `${activeCount} ${activeCount === 1 ? "pessoa" : "pessoas"} no canal`
                : "Compartilhe o que importa."}
            </span>
          </div>
          <div className="primary-controls">
            {local ? (
              <>
                <button
                  className="btn control-settings"
                  onClick={() => open(local ? "quality" : "share")}
                >
                  <Icon name="settings" /><span>Qualidade</span>
                </button>

                <button
                  className="btn"
                  onClick={() => {
                    setError("");
                    void perform(async () => { await client.switchSource(quality); });
                  }}
                >
                  <Icon name="swap" /><span>Trocar tela/janela</span>
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => void perform(() => client.stopScreenShare())}
                >
                  <Icon name="stop" /><span>Parar transmissão</span>
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!selected || phase !== "connected" || busy}
                onClick={() => open(local ? "quality" : "share")}
              >
                <Icon name="monitor" /><span>Compartilhar tela</span>
              </button>
            )}
          </div>
          <span className="control-caption control-brand">Velun<span> Gx</span><AppVersion /></span>
        </footer>
      </section>
      {details && showMembers && <MembersPanel details={details} presence={presence} choose={setMemberMenu} close={() => setShowMembers(false)} />}
      {details && profile && memberMenu && (() => { const identity = presence.flatMap((c) => c.participants).find((p) => p.userId === memberMenu.id)?.identity; const participant = participants.find((p) => p.identity === identity); return <MemberMenu key={memberMenu.id} details={details} actor={profile.id} member={details.members.find((m) => m.id === memberMenu.id) ?? memberMenu} presence={presence} ping={memberMenu.id === profile.id ? appPing : participant?.report?.appPingMs} mediaPing={participant?.report?.rttMs} chooseLive={(channel, id) => void watchFromChannel(channel, id)} close={() => setMemberMenu(null)} refresh={refresh} fail={fail} />; })()}
      {dialog && (
        <div
          className="workspace-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setDialog(null);
          }}
        >
          <section
            className="workspace-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setDialog(null);
            }}
          >
            <button
              className="modal-close"
              aria-label="Fechar"
              onClick={() => setDialog(null)}
              disabled={busy}
            >
              ×
            </button>
            {dialog === "server" && (
              <>
                <span className="eyebrow">SEU PRÓXIMO ESPAÇO</span>
                <h2 id="dialog-title">Adicionar servidor</h2>
                <p className="muted">
                  Crie um ponto de encontro ou entre com um convite.
                </p>
                <form onSubmit={(e) => void createServer(e)}>
                  <label className="field-label" htmlFor="server-name">
                    Nome do servidor
                  </label>
                  <input
                    autoFocus
                    id="server-name"
                    className="input"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button className="btn btn-primary" disabled={busy}>
                    Criar servidor
                  </button>
                  <IconPicker value={icon} onChange={setIcon} />
                </form>
                <div className="modal-divider" />
                <label className="field-label" htmlFor="invite-code">
                  Link ou código do convite
                </label>
                <input
                  id="invite-code"
                  className="input"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={() => void acceptInvite()}
                  disabled={busy || !inviteCode.trim()}
                >
                  Entrar no servidor
                </button>
              </>
            )}
            {dialog === "channel" && (
              <>
                <h2 id="dialog-title">
                  {editingChannel ? "Configurar canal" : "Criar canal"}
                </h2>
                <form onSubmit={(e) => void saveChannel(e)}>
                  <label className="field-label" htmlFor="channel-name">
                    Nome do canal
                  </label>
                  <input
                    autoFocus
                    className="input"
                    id="channel-name"
                    maxLength={80}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button className="btn btn-primary" disabled={busy}>
                    Salvar canal
                  </button>
                </form>
                {editingChannel && (
                  <>
                    <div className="modal-actions">
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void move(editingChannel, -1)}
                      >
                        ↑ Mover acima
                      </button>
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void move(editingChannel, 1)}
                      >
                        ↓ Mover abaixo
                      </button>
                    </div>
                    {confirmDelete ? (
                      <p className="error-text">
                        A exclusão desconecta todos deste canal.{" "}
                        <button
                          className="btn btn-danger"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await api.removeChannel(editingChannel.id);
                              if (selected?.id === editingChannel.id)
                                await exit();
                              await refresh();
                              setDialog(null);
                            })
                          }
                        >
                          Confirmar exclusão do canal
                        </button>
                      </p>
                    ) : (
                      <button
                        className="btn btn-danger"
                        onClick={() => setConfirmDelete(true)}
                      >
                        Excluir canal
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            {dialog === "invite" && details && (
              <>
                <h2 id="dialog-title">Convide sua turma</h2>
                <p className="muted">
                  O convite dá acesso ao servidor {details.name} e não expira. Se
                  precisar, revogue-o abaixo em "Convites ativos".
                </p>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const invite = await api.invite(details.id);
                      setInviteLink(
                        `${window.location.origin}/invite/${invite.code}`,
                      );
                      setInvites(await api.invites(details.id));
                    })
                  }
                >
                  Gerar convite
                </button>
                {inviteLink && (
                  <>
                    <label className="field-label" htmlFor="server-invite">
                      Link de convite
                    </label>
                    <input
                      id="server-invite"
                      className="input"
                      readOnly
                      value={inviteLink}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      className="btn"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(inviteLink)
                          .then(() => setCopied(true), fail);
                      }}
                    >
                      {copied ? "Copiado!" : "Copiar convite"}
                    </button>
                  </>
                )}
                <h3>Convites ativos</h3>
                <div className="invite-management">
                  {invites
                    .filter(
                      (i) =>
                        !i.revokedAt && (i.expiresAt === null || Date.parse(i.expiresAt) > Date.now()),
                    )
                    .map((i) => (
                      <div key={i.id}>
                        <span>
                          {i.uses} usos ·{" "}
                          {i.expiresAt === null
                            ? "sem prazo"
                            : `até ${new Date(i.expiresAt).toLocaleDateString("pt-BR")}`}
                        </span>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await api.revoke(details.id, i.id);
                              setInvites(await api.invites(details.id));
                              setInviteLink("");
                            })
                          }
                        >
                          Revogar
                        </button>
                      </div>
                    ))}
                </div>
              </>
            )}
            {dialog === "share" && <>
              <span className="eyebrow">COMPARTILHAR COM O CANAL</span>
              <h2 id="dialog-title">O que você quer transmitir?</h2>
              <p className="muted">Escolha a qualidade e a fonte. O áudio é enviado automaticamente quando disponível.</p>
              <QualityFields value={quality} onChange={setQuality} />
              <label className="checkbox hw-encoding-option"><input type="checkbox" checked={hardwareEncoding} onChange={(e) => { setHardwareEncodingPreferred(e.target.checked); setHardwareEncoding(e.target.checked); }} /><span><strong>Aceleração de hardware (placa de vídeo)</strong><small className="muted">{h264HardwareKnown() === false ? "Na última transmissão a placa de vídeo deste PC não codificou H.264; o app usa o processador." : "Transmite em H.264 pela placa de vídeo (NVIDIA, AMD ou Intel): menos peso no processador durante o jogo. Desligado, o app escolhe VP9 ou VP8 conforme o seu processador."}</small></span></label>
              {velunBridge() && desktopProcessAudio() === false && <label className="checkbox pc-audio-option"><input type="checkbox" checked={pcAudio} onChange={(e) => { setPcAudioAllowed(e.target.checked); setPcAudio(e.target.checked); }} /><span><strong>Som do PC (inclui a call do Discord)</strong><small className="muted">Seu Windows não permite tirar programas do som (é anterior ao Windows 10 versão 2004): quem assiste ouve tudo que toca no seu PC, inclusive a call. Enquanto você transmite com som, as outras transmissões ficam mudas para você, senão voltariam como eco. Atualizando o Windows, o Velun Gx tira a call e esse problema deixa de existir.</small></span></label>}
              {!velunBridge() && !detectShareCapabilities().canShareAudio && <p className="audio-warning" role="note">Este navegador não envia o som da tela (o Firefox, por exemplo, não oferece isso). Para transmitir com áudio, use o app Velun Gx (botão ⬇ Baixar app) ou o Chrome/Edge.</p>}
              <div className="share-source-options">
                <button disabled={busy || phase !== "connected"} onClick={() => void applyQuality("window")}><Icon name="focus" size={36} /><strong>Janela</strong><small>Um aplicativo específico</small></button>
                <button disabled={busy || phase !== "connected"} onClick={() => void applyQuality("monitor")}><Icon name="monitor" size={36} /><strong>Tela inteira</strong><small>Tudo o que está na tela</small></button>
              </div>
              <p className="muted small">O seletor do sistema confirma a fonte e as permissões. A qualidade também pode ser ajustada durante a transmissão, sem interrompê-la.</p>
            </>}
            {dialog === "quality" && (
              <>
                <span className="eyebrow">
                  {local
                    ? "SEM INTERROMPER SUA TELA"
                    : "ESCOLHA COMO TRANSMITIR"}
                </span>
                <h2 id="dialog-title">
                  {local ? "Qualidade da transmissão" : "Compartilhar tela"}
                </h2>
                <p className="muted">
                  Escolha nitidez e fluidez. O navegador abrirá o seletor de tela, janela ou aba.
                </p>
                <QualityFields value={quality} onChange={setQuality} />
                <p className="muted small">O áudio da fonte é enviado automaticamente quando disponível. Quem assiste controla o volume e o mute.</p>
                {local?.audioRequested && !local.hasAudio && <p className="audio-warning">{local.audioError ? `Sem som: ${local.audioError} O vídeo continua normalmente.` : "O navegador não forneceu áudio para esta fonte. O vídeo continua normalmente."}</p>}
                {local && (
                  <p className="muted small">
                    Captura atual: {local.width} × {local.height} · {local.fps}{" "}
                    FPS. A resolução respeita a proporção original e os limites
                    do navegador/servidor.
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    className="btn"
                    onClick={() => setDialog(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => void applyQuality()}
                    disabled={busy || phase !== "connected"}
                  >
                    {busy
                      ? "Aplicando…"
                      : local
                        ? "Aplicar qualidade"
                        : "Começar transmissão"}
                  </button>
                </div>
              </>
            )}
            {dialog === "diagnostics" && <Diagnostics />}

            {dialog === "account" && (
              <>
                <h2 id="dialog-title">Sua conta</h2>
                <div className="account-identity">
                  <span className="user-avatar">
                    {profile?.name.slice(0, 2).toUpperCase()}
                  </span>
                  <strong>{profile?.name}</strong>
                  {profile && profile.name !== profile.username && <small className="muted">@{profile.username}</small>}
                </div>
                {profile && <NicknameForm profile={profile} onSaved={setProfile} />}
                {profile && <PasswordForm onSaved={setProfile} />}
                <SoundSettings />
                <DownloadApp />
                <p className="muted">
                  Seus servidores continuam vinculados à sua conta quando você
                  volta.
                </p>
                <p className="muted small">
                  Ainda não existe recuperação de senha. Guarde-a em um lugar
                  seguro.
                </p>
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await exit();
                      await accounts.logout();
                      navigate("/login", { replace: true });
                    })
                  }
                >
                  Sair da conta
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
    </StreamContext.Provider>
  );
}
