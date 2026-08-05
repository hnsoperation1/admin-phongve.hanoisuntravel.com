export interface User {
  id: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  is_super_admin?: boolean
  ke_toan?: boolean
  ke_toan_super_admin?: boolean
}
