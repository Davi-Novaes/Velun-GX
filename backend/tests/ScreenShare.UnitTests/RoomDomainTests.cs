using ScreenShare.Domain.Participants;
using ScreenShare.Domain.Rooms;

namespace ScreenShare.UnitTests;

public sealed class RoomCodeTests
{
    [Fact]
    public void New_codes_use_crockford_alphabet_and_do_not_repeat()
    {
        var codes = Enumerable.Range(0, 10_000).Select(_ => RoomCode.New().Value).ToList();

        Assert.All(codes, c => Assert.Matches("^[0-9A-HJKMNP-TV-Z]{8}$", c));
        Assert.Equal(codes.Count, codes.Distinct().Count());
    }

    [Theory]
    [InlineData("k7f3qx9m", "K7F3QX9M")]
    [InlineData("K7F3-QX9M", "K7F3QX9M")]
    [InlineData("O1IL0000", "01110000")]
    public void Parse_tolerates_case_hyphens_and_ambiguous_letters(string input, string expected)
    {
        Assert.True(RoomCode.TryParse(input, out var code));
        Assert.Equal(expected, code.Value);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("K7F3QX9")]
    [InlineData("K7F3QX9MM")]
    [InlineData("K7F3QX9U")]
    [InlineData("K7F3QX9!")]
    [InlineData("../../etc")]
    public void Parse_rejects_invalid_codes(string? input) => Assert.False(RoomCode.TryParse(input, out _));
}

public sealed class DisplayNameTests
{
    [Theory]
    [InlineData("Maria", "Maria")]
    [InlineData("  João   da  Silva  ", "João da Silva")]
    [InlineData("José", "José")]              // normalizado para NFC
    [InlineData("Ana​\u0007", "Ana")]          // remove formatação e controle
    [InlineData("👩‍💻 Dev", "👩‍💻 Dev")]              // emoji composto conta como 1
    public void Valid_names_are_normalized(string input, string expected)
    {
        Assert.True(DisplayName.TryCreate(input, out var name));
        Assert.Equal(expected, name.Value);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("​​")]
    [InlineData("123456789012345678901234567890123")]
    public void Invalid_names_are_rejected(string? input) => Assert.False(DisplayName.TryCreate(input, out _));

    [Fact]
    public void Thirty_two_visible_characters_are_allowed()
    {
        Assert.True(DisplayName.TryCreate(new string('a', 32), out _));
        Assert.True(DisplayName.TryCreate(string.Concat(Enumerable.Repeat("👍🏽", 32)), out _));
    }
}

public sealed class ParticipantTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    private static Participant NewParticipant()
    {
        Assert.True(DisplayName.TryCreate("Ana", out var name));
        return Participant.Create(Guid.NewGuid(), Guid.NewGuid(), name, ParticipantRoles.Member, Now);
    }

    [Fact]
    public void New_participant_reserves_slot_for_60_seconds()
    {
        var p = NewParticipant();

        Assert.Equal(ParticipantStatus.Joining, p.Status);
        Assert.True(p.HoldsReservation(Now.AddSeconds(59)));
        Assert.False(p.HoldsReservation(Now.AddSeconds(60)));
        Assert.Equal(ParticipantIdentity.From(p.Id).Value, p.Identity);
    }

    [Fact]
    public void Leave_from_replaced_sfu_session_is_ignored()
    {
        var p = NewParticipant();
        p.MarkConnected("PA_old", Now);
        p.MarkConnected("PA_new", Now.AddSeconds(5));

        Assert.False(p.MarkLeft("PA_old", "signal_close", Now.AddSeconds(6)));
        Assert.Equal(ParticipantStatus.Connected, p.Status);
        Assert.True(p.MarkLeft("PA_new", "client_initiated", Now.AddSeconds(7)));
        Assert.Equal(ParticipantStatus.Disconnected, p.Status);
    }

    [Fact]
    public void Rejoin_counts_reconnections_and_clears_departure()
    {
        var p = NewParticipant();
        p.MarkConnected("PA_1", Now);
        p.MarkLeft("PA_1", "signal_close", Now.AddMinutes(1));
        Assert.True(DisplayName.TryCreate("Ana 2", out var name));

        p.Rejoin(name, Now.AddMinutes(2));

        Assert.Equal(1, p.ReconnectCount);
        Assert.Null(p.LeftAt);
        Assert.Equal("Ana 2", p.DisplayName);
        Assert.True(p.HoldsReservation(Now.AddMinutes(2)));
    }
}

public sealed class RoomTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Room_expires_after_24h_of_inactivity_and_touch_extends_it()
    {
        var owner = Guid.NewGuid();
        var room = Room.Create(RoomCode.New(), owner, Now);

        Assert.False(room.IsExpired(Now.AddHours(23)));
        Assert.True(room.IsExpired(Now.AddHours(24)));

        room.Touch(Now.AddHours(23));
        Assert.False(room.IsExpired(Now.AddHours(46)));

        Assert.Equal(ParticipantRoles.Owner, room.RoleFor(owner));
        Assert.Equal(ParticipantRoles.Member, room.RoleFor(Guid.NewGuid()));
    }

    [Fact]
    public void Expired_room_cannot_be_revived()
    {
        var room = Room.Create(RoomCode.New(), Guid.NewGuid(), Now);
        room.Expire();
        room.Touch(Now.AddMinutes(1));

        Assert.True(room.IsExpired(Now.AddMinutes(1)));
    }
}
