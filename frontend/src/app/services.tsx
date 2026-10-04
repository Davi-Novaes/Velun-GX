import { createContext, type ReactNode, useContext } from 'react'
import { api } from '../api/client'
import { LiveKitRoomClient } from '../media/LiveKitRoomClient'
import type { RoomClient } from '../media/RoomClient'
import { accounts } from '../api/accounts'
import { admin } from '../api/admin'

/** Dependências trocáveis em testes (API e cliente de mídia). */
export interface Services {
  accounts: typeof accounts
  admin: typeof admin
  api: typeof api
  createRoomClient: () => RoomClient
}

const defaultServices: Services = {
  accounts,
  admin,
  api,
  createRoomClient: () => new LiveKitRoomClient(),
}

const ServicesContext = createContext<Services>(defaultServices)

export function ServicesProvider({ services, children }: { services?: Partial<Services>; children: ReactNode }) {
  return <ServicesContext.Provider value={{ ...defaultServices, ...services }}>{children}</ServicesContext.Provider>
}

export function useServices(): Services {
  return useContext(ServicesContext)
}
