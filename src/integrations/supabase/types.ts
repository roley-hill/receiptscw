export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      appfolio_tenants: {
        Row: {
          appfolio_id: string
          company_name: string | null
          created_at: string
          email: string | null
          first_name: string
          full_name: string | null
          id: string
          last_name: string
          move_in_on: string | null
          move_out_on: string | null
          phone: string | null
          primary_tenant: boolean | null
          property_address: string | null
          property_id: string | null
          status: string | null
          synced_at: string
          unit_id: string | null
          unit_number: string | null
          updated_at: string
        }
        Insert: {
          appfolio_id: string
          company_name?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          full_name?: string | null
          id?: string
          last_name?: string
          move_in_on?: string | null
          move_out_on?: string | null
          phone?: string | null
          primary_tenant?: boolean | null
          property_address?: string | null
          property_id?: string | null
          status?: string | null
          synced_at?: string
          unit_id?: string | null
          unit_number?: string | null
          updated_at?: string
        }
        Update: {
          appfolio_id?: string
          company_name?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          full_name?: string | null
          id?: string
          last_name?: string
          move_in_on?: string | null
          move_out_on?: string | null
          phone?: string | null
          primary_tenant?: boolean | null
          property_address?: string | null
          property_id?: string | null
          status?: string | null
          synced_at?: string
          unit_id?: string | null
          unit_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      charge_details: {
        Row: {
          account_name: string
          account_number: string
          appfolio_tenant_id: string | null
          charge_amount: number
          charge_date: string | null
          charged_to: string
          created_at: string
          id: string
          is_subsidy: boolean
          paid_amount: number
          property_address: string
          receipt_date: string | null
          reference: string | null
          subsidy_provider: string | null
          synced_at: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          account_name?: string
          account_number?: string
          appfolio_tenant_id?: string | null
          charge_amount?: number
          charge_date?: string | null
          charged_to?: string
          created_at?: string
          id?: string
          is_subsidy?: boolean
          paid_amount?: number
          property_address?: string
          receipt_date?: string | null
          reference?: string | null
          subsidy_provider?: string | null
          synced_at?: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          appfolio_tenant_id?: string | null
          charge_amount?: number
          charge_date?: string | null
          charged_to?: string
          created_at?: string
          id?: string
          is_subsidy?: boolean
          paid_amount?: number
          property_address?: string
          receipt_date?: string | null
          reference?: string | null
          subsidy_provider?: string | null
          synced_at?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      deposit_batches: {
        Row: {
          batch_id: string
          created_at: string
          created_by: string | null
          deposit_period: string | null
          external_reference: string | null
          id: string
          notes: string | null
          property: string
          receipt_count: number
          status: Database["public"]["Enums"]["batch_status"]
          total_amount: number
          transfer_method: string | null
          transferred_at: string | null
          transferred_by: string | null
          updated_at: string
        }
        Insert: {
          batch_id?: string
          created_at?: string
          created_by?: string | null
          deposit_period?: string | null
          external_reference?: string | null
          id?: string
          notes?: string | null
          property: string
          receipt_count?: number
          status?: Database["public"]["Enums"]["batch_status"]
          total_amount?: number
          transfer_method?: string | null
          transferred_at?: string | null
          transferred_by?: string | null
          updated_at?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_by?: string | null
          deposit_period?: string | null
          external_reference?: string | null
          id?: string
          notes?: string | null
          property?: string
          receipt_count?: number
          status?: Database["public"]["Enums"]["batch_status"]
          total_amount?: number
          transfer_method?: string | null
          transferred_at?: string | null
          transferred_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          amount: number
          appfolio_recorded: boolean
          appfolio_recorded_at: string | null
          appfolio_recorded_by: string | null
          batch_id: string | null
          confidence_scores: Json | null
          created_at: string
          file_content_hash: string | null
          file_name: string | null
          file_path: string | null
          finalized_at: string | null
          id: string
          memo: string | null
          original_text: string | null
          payment_type: string | null
          property: string
          receipt_date: string | null
          receipt_id: string
          reference: string | null
          rent_month: string | null
          status: Database["public"]["Enums"]["receipt_status"]
          subsidy_provider: string | null
          tenant: string
          transfer_status: Database["public"]["Enums"]["transfer_status"]
          transferred_at: string | null
          transferred_by: string | null
          unit: string
          updated_at: string
          uploaded_at: string
          user_id: string | null
        }
        Insert: {
          amount?: number
          appfolio_recorded?: boolean
          appfolio_recorded_at?: string | null
          appfolio_recorded_by?: string | null
          batch_id?: string | null
          confidence_scores?: Json | null
          created_at?: string
          file_content_hash?: string | null
          file_name?: string | null
          file_path?: string | null
          finalized_at?: string | null
          id?: string
          memo?: string | null
          original_text?: string | null
          payment_type?: string | null
          property?: string
          receipt_date?: string | null
          receipt_id?: string
          reference?: string | null
          rent_month?: string | null
          status?: Database["public"]["Enums"]["receipt_status"]
          subsidy_provider?: string | null
          tenant?: string
          transfer_status?: Database["public"]["Enums"]["transfer_status"]
          transferred_at?: string | null
          transferred_by?: string | null
          unit?: string
          updated_at?: string
          uploaded_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          appfolio_recorded?: boolean
          appfolio_recorded_at?: string | null
          appfolio_recorded_by?: string | null
          batch_id?: string | null
          confidence_scores?: Json | null
          created_at?: string
          file_content_hash?: string | null
          file_name?: string | null
          file_path?: string | null
          finalized_at?: string | null
          id?: string
          memo?: string | null
          original_text?: string | null
          payment_type?: string | null
          property?: string
          receipt_date?: string | null
          receipt_id?: string
          reference?: string | null
          rent_month?: string | null
          status?: Database["public"]["Enums"]["receipt_status"]
          subsidy_provider?: string | null
          tenant?: string
          transfer_status?: Database["public"]["Enums"]["transfer_status"]
          transferred_at?: string | null
          transferred_by?: string | null
          unit?: string
          updated_at?: string
          uploaded_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_receipts_batch"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "deposit_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      rent_roll_charges: {
        Row: {
          appfolio_tenant_id: string | null
          charge_type: string
          created_at: string
          description: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          monthly_amount: number
          property_address: string
          synced_at: string
          tenant_name: string
          unit_number: string | null
          updated_at: string
        }
        Insert: {
          appfolio_tenant_id?: string | null
          charge_type?: string
          created_at?: string
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          monthly_amount?: number
          property_address?: string
          synced_at?: string
          tenant_name?: string
          unit_number?: string | null
          updated_at?: string
        }
        Update: {
          appfolio_tenant_id?: string | null
          charge_type?: string
          created_at?: string
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          monthly_amount?: number
          property_address?: string
          synced_at?: string
          tenant_name?: string
          unit_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      skipped_duplicates: {
        Row: {
          amount: number
          confidence_scores: Json | null
          created_at: string
          existing_receipt_id: string
          existing_receipt_uuid: string | null
          file_name: string | null
          file_path: string | null
          id: string
          memo: string | null
          payment_type: string | null
          property: string
          receipt_date: string | null
          reference: string | null
          rent_month: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          tenant: string
          unit: string
          user_id: string | null
        }
        Insert: {
          amount?: number
          confidence_scores?: Json | null
          created_at?: string
          existing_receipt_id: string
          existing_receipt_uuid?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          memo?: string | null
          payment_type?: string | null
          property?: string
          receipt_date?: string | null
          reference?: string | null
          rent_month?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant?: string
          unit?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          confidence_scores?: Json | null
          created_at?: string
          existing_receipt_id?: string
          existing_receipt_uuid?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          memo?: string | null
          payment_type?: string | null
          property?: string
          receipt_date?: string | null
          reference?: string | null
          rent_month?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant?: string
          unit?: string
          user_id?: string | null
        }
        Relationships: []
      }
      upload_batch_files: {
        Row: {
          batch_id: string
          created_at: string
          duplicate_count: number | null
          error: string | null
          file_name: string
          file_size: number
          id: string
          inserted_count: number | null
          status: string
          total_line_items: number | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          duplicate_count?: number | null
          error?: string | null
          file_name: string
          file_size?: number
          id?: string
          inserted_count?: number | null
          status?: string
          total_line_items?: number | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          duplicate_count?: number | null
          error?: string | null
          file_name?: string
          file_size?: number
          id?: string
          inserted_count?: number | null
          status?: string
          total_line_items?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_batch_files_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_batches: {
        Row: {
          created_at: string
          file_count: number
          id: string
          processed_count: number
          status: string
          uploaded_by_email: string | null
          uploaded_by_name: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          file_count?: number
          id?: string
          processed_count?: number
          status?: string
          uploaded_by_email?: string | null
          uploaded_by_name?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          file_count?: number
          id?: string
          processed_count?: number
          status?: string
          uploaded_by_email?: string | null
          uploaded_by_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_safe: {
        Row: {
          created_at: string | null
          display_name: string | null
          email: string | null
          id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          email?: never
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          email?: never
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_authenticated_with_role: { Args: never; Returns: boolean }
      is_processor_or_above: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "processor" | "viewer"
      batch_status: "draft" | "ready" | "transferred" | "reversed"
      receipt_status: "needs_review" | "finalized" | "exception"
      transfer_status: "untransferred" | "transferred" | "reversed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "processor", "viewer"],
      batch_status: ["draft", "ready", "transferred", "reversed"],
      receipt_status: ["needs_review", "finalized", "exception"],
      transfer_status: ["untransferred", "transferred", "reversed"],
    },
  },
} as const
