
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "app_settings": {
                  Row: {
                    "cancel_min_notice_hours": number,"id": boolean,"max_booking_days": number,"min_booking_notice_min": number,"return_reminder_days": number,"return_reminder_enabled": boolean,"return_reminder_from_hour": number,"return_reminder_message": string,"return_reminder_until_hour": number,"slot_step_min": number,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_min_notice_hours"?: number,"id"?: boolean,"max_booking_days"?: number,"min_booking_notice_min"?: number,"return_reminder_days"?: number,"return_reminder_enabled"?: boolean,"return_reminder_from_hour"?: number,"return_reminder_message"?: string,"return_reminder_until_hour"?: number,"slot_step_min"?: number,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "cancel_min_notice_hours"?: number,"id"?: boolean,"max_booking_days"?: number,"min_booking_notice_min"?: number,"return_reminder_days"?: number,"return_reminder_enabled"?: boolean,"return_reminder_from_hour"?: number,"return_reminder_message"?: string,"return_reminder_until_hour"?: number,"slot_step_min"?: number,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"appointment_services": {
                  Row: {
                    "appointment_id": string,"duration_min": number,"price_cents": number,"service_id": string,"service_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"duration_min": number,"price_cents": number,"service_id": string,"service_name": string
                  }
                  Update: {
                    "appointment_id"?: string,"duration_min"?: number,"price_cents"?: number,"service_id"?: string,"service_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_services_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_services_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"appointments": {
                  Row: {
                    "barber_id": string,"cancel_token_hash": string,"cancelled_at": string | null,"cancelled_by": Database["public"]['Enums']["cancel_actor"] | null,"completed_at": string | null,"completion_reminded_at": string | null,"created_at": string,"customer_id": string,"ends_at": string,"id": string,"paid_cents": number | null,"payment_method": Database["public"]['Enums']["payment_method"] | null,"return_pending": boolean,"return_reminded_at": string | null,"starts_at": string,"status": Database["public"]['Enums']["appointment_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "barber_id": string,"cancel_token_hash": string,"cancelled_at"?: string | null,"cancelled_by"?: Database["public"]['Enums']["cancel_actor"] | null,"completed_at"?: string | null,"completion_reminded_at"?: string | null,"created_at"?: string,"customer_id": string,"ends_at": string,"id"?: string,"paid_cents"?: number | null,"payment_method"?: Database["public"]['Enums']["payment_method"] | null,"return_pending"?: boolean,"return_reminded_at"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string
                  }
                  Update: {
                    "barber_id"?: string,"cancel_token_hash"?: string,"cancelled_at"?: string | null,"cancelled_by"?: Database["public"]['Enums']["cancel_actor"] | null,"completed_at"?: string | null,"completion_reminded_at"?: string | null,"created_at"?: string,"customer_id"?: string,"ends_at"?: string,"id"?: string,"paid_cents"?: number | null,"payment_method"?: Database["public"]['Enums']["payment_method"] | null,"return_pending"?: boolean,"return_reminded_at"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_barber_id_fkey"
      columns: ["barber_id"]
isOneToOne: false
      referencedRelation: "barbers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
                  ]
                },"barber_services": {
                  Row: {
                    "barber_id": string,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "barber_id": string,"service_id": string
                  }
                  Update: {
                    "barber_id"?: string,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "barber_services_barber_id_fkey"
      columns: ["barber_id"]
isOneToOne: false
      referencedRelation: "barbers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "barber_services_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"barbers": {
                  Row: {
                    "active": boolean,"created_at": string,"display_name": string,"id": string,"photo_url": string | null,"profile_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"display_name": string,"id"?: string,"photo_url"?: string | null,"profile_id": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"display_name"?: string,"id"?: string,"photo_url"?: string | null,"profile_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "barbers_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "auth_user_id": string | null,"created_at": string,"id": string,"is_guest": boolean,"name": string,"phone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_user_id"?: string | null,"created_at"?: string,"id"?: string,"is_guest"?: boolean,"name": string,"phone": string
                  }
                  Update: {
                    "auth_user_id"?: string | null,"created_at"?: string,"id"?: string,"is_guest"?: boolean,"name"?: string,"phone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"loyalty_redemptions": {
                  Row: {
                    "customer_id": string,"id": string,"redeemed_at": string,"redeemed_by": string | null,"reward_description": string,"stamps_used": number
                  }
                  ComputedFields: never
                  Insert: {
                    "customer_id": string,"id"?: string,"redeemed_at"?: string,"redeemed_by"?: string | null,"reward_description": string,"stamps_used": number
                  }
                  Update: {
                    "customer_id"?: string,"id"?: string,"redeemed_at"?: string,"redeemed_by"?: string | null,"reward_description"?: string,"stamps_used"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "loyalty_redemptions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "loyalty_redemptions_redeemed_by_fkey"
      columns: ["redeemed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"loyalty_rules": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"reward_description": string,"stamps_required": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"reward_description": string,"stamps_required": number
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"reward_description"?: string,"stamps_required"?: number
                  }
                  Relationships: [
                    
                  ]
                },"loyalty_stamps": {
                  Row: {
                    "appointment_id": string,"created_at": string,"customer_id": string,"id": string,"redemption_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"created_at"?: string,"customer_id": string,"id"?: string,"redemption_id"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string,"created_at"?: string,"customer_id"?: string,"id"?: string,"redemption_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "loyalty_stamps_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: true
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "loyalty_stamps_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "loyalty_stamps_redemption_id_fkey"
      columns: ["redemption_id"]
isOneToOne: false
      referencedRelation: "loyalty_redemptions"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"phone": string | null,"role": Database["public"]['Enums']["user_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"name": string,"phone"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"phone"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"p256dh": string,"user_agent": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string,"user_agent"?: string | null,"user_id": string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"services": {
                  Row: {
                    "active": boolean,"created_at": string,"duration_min": number,"id": string,"name": string,"price_cents": number,"return_reminder": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"duration_min": number,"id"?: string,"name": string,"price_cents": number,"return_reminder"?: boolean
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"duration_min"?: number,"id"?: string,"name"?: string,"price_cents"?: number,"return_reminder"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"time_off": {
                  Row: {
                    "barber_id": string,"created_at": string,"ends_at": string,"id": string,"reason": string | null,"starts_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "barber_id": string,"created_at"?: string,"ends_at": string,"id"?: string,"reason"?: string | null,"starts_at": string
                  }
                  Update: {
                    "barber_id"?: string,"created_at"?: string,"ends_at"?: string,"id"?: string,"reason"?: string | null,"starts_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_off_barber_id_fkey"
      columns: ["barber_id"]
isOneToOne: false
      referencedRelation: "barbers"
      referencedColumns: ["id"]
    }
                  ]
                },"working_hours": {
                  Row: {
                    "barber_id": string,"break_end": string | null,"break_start": string | null,"end_time": string,"id": string,"start_time": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "barber_id": string,"break_end"?: string | null,"break_start"?: string | null,"end_time": string,"id"?: string,"start_time": string,"weekday": number
                  }
                  Update: {
                    "barber_id"?: string,"break_end"?: string | null,"break_start"?: string | null,"end_time"?: string,"id"?: string,"start_time"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "working_hours_barber_id_fkey"
      columns: ["barber_id"]
isOneToOne: false
      referencedRelation: "barbers"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_delete_customer":
{ Args: { "p_id": string }; Returns: undefined
                           },
"admin_update_customer":
{ Args: { "p_id": string,"p_name": string,"p_phone": string }; Returns: {
              "auth_user_id": string | null,
"created_at": string,
"id": string,
"is_guest": boolean,
"name": string,
"phone": string
            }
                          SetofOptions: {
        from: "*"
        to: "customers"
        isOneToOne: true
        isSetofReturn: false
      } },
"book_appointment":
{ Args: { "p_auth_user_id"?: string,"p_barber_id": string,"p_cancel_token_hash": string,"p_customer_name": string,"p_customer_phone": string,"p_service_ids": (string)[],"p_starts_at": string }; Returns: {
              "appointment_id": string,"customer_id": string,"customer_name": string,"ends_at": string,"starts_at": string,"total_price_cents": number
            }[]
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_max": number,"p_window_seconds": number }; Returns: boolean
                           },
"redeem_loyalty":
{ Args: { "p_customer_id": string,"p_redeemed_by": string }; Returns: {
              "customer_id": string,
"id": string,
"redeemed_at": string,
"redeemed_by": string | null,
"reward_description": string,
"stamps_used": number
            }
                          SetofOptions: {
        from: "*"
        to: "loyalty_redemptions"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            "appointment_status": "scheduled"|"cancelled"|"completed"|"no_show","cancel_actor": "customer"|"barber"|"admin"|"system","payment_method": "pix"|"cash"|"debit"|"credit","user_role": "customer"|"barber"|"admin"|"super_admin"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "appointment_status": ["scheduled", "cancelled", "completed", "no_show"],"cancel_actor": ["customer", "barber", "admin", "system"],"payment_method": ["pix", "cash", "debit", "credit"],"user_role": ["customer", "barber", "admin", "super_admin"]
          }
        }
} as const
