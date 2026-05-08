export type ID = string
export type ISODateString = string

export type User = {
  id: ID
  org_id: ID
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
