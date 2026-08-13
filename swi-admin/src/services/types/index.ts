export type ID = string
export type ISODateString = string

// Envelope compartilhado da camada de serviço: a API REST e as simulações
// devolvem o mesmo formato { data, error } para as telas não distinguirem a
// origem. Vive aqui, num módulo neutro, para o caminho de produção não
// importar nada do namespace de simulação.
export type ServiceError = { message: string; code?: string }

export type ServiceResponse<T> = {
  data: T | null
  error: ServiceError | null
  count?: number
}

export type User = {
  id: ID
  email: string
  full_name: string
  role: 'admin' | 'super_admin'
  consent_given_at: ISODateString | null
  created_at: ISODateString
  // Mock biometrics for dashboard Header. S2 will source from real device.
  bpm?: number
  pressure?: string
  avatarUri?: string
}

export type Employee = {
  id: ID
  org_id: ID
  full_name: string
  cpf: string
  blood_type: string | null
  allergies: string | null
  status: 'good' | 'alert' | 'low' | 'offline'
  last_location: { lat: number; lng: number; updated_at: ISODateString } | null
  created_at: ISODateString
}

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertState =
  | 'open'
  | 'acknowledged'
  | 'rescue_route_assigned'
  | 'rescue_ongoing'
  | 'closed'
  | 'cancelled'

export type Alert = {
  id: ID
  org_id: ID
  employee_id: ID
  severity: AlertSeverity
  state: AlertState
  type: 'health' | 'meteorologic' | 'manual'
  message: string
  created_at: ISODateString
  acknowledged_at: ISODateString | null
  closed_at: ISODateString | null
}
