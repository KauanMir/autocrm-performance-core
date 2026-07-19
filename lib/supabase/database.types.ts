export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      companies: {
        Row: {
          cnpj: string | null
          created_at: string
          id: string
          name: string
          phone: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_timeline_entries: {
        Row: {
          actor_profile_id: string | null
          color: string
          company_id: string
          created_at: string
          detail: string | null
          icon: string
          id: string
          label: string
          lead_id: string
          occurred_at: string
        }
        Insert: {
          actor_profile_id?: string | null
          color: string
          company_id: string
          created_at?: string
          detail?: string | null
          icon: string
          id?: string
          label: string
          lead_id: string
          occurred_at?: string
        }
        Update: {
          actor_profile_id?: string | null
          color?: string
          company_id?: string
          created_at?: string
          detail?: string | null
          icon?: string
          id?: string
          label?: string
          lead_id?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_timeline_actor_fk"
            columns: ["company_id", "actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "lead_timeline_company_lead_fk"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      leads: {
        Row: {
          alert_label: string | null
          archived_at: string | null
          car: string
          company_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          last_activity_label: string | null
          name: string
          payment_preference: string | null
          phone: string
          phone_digits: string | null
          seller_id: string | null
          source: string | null
          stage_id: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at: string
          updated_by_profile_id: string | null
          urgency: Database["public"]["Enums"]["lead_urgency"]
          value_amount: number | null
          version: number
        }
        Insert: {
          alert_label?: string | null
          archived_at?: string | null
          car: string
          company_id: string
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          last_activity_label?: string | null
          name: string
          payment_preference?: string | null
          phone: string
          phone_digits?: string | null
          seller_id?: string | null
          source?: string | null
          stage_id: string
          temperature?: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at?: string
          updated_by_profile_id?: string | null
          urgency?: Database["public"]["Enums"]["lead_urgency"]
          value_amount?: number | null
          version?: number
        }
        Update: {
          alert_label?: string | null
          archived_at?: string | null
          car?: string
          company_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          last_activity_label?: string | null
          name?: string
          payment_preference?: string | null
          phone?: string
          phone_digits?: string | null
          seller_id?: string | null
          source?: string | null
          stage_id?: string
          temperature?: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at?: string
          updated_by_profile_id?: string | null
          urgency?: Database["public"]["Enums"]["lead_urgency"]
          value_amount?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_company_seller_fk"
            columns: ["company_id", "seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "leads_company_stage_fk"
            columns: ["company_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "leads_created_by_fk"
            columns: ["company_id", "created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "leads_updated_by_fk"
            columns: ["company_id", "updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_terminal: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_terminal?: boolean
          name: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_terminal?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          role: Database["public"]["Enums"]["user_role"]
          seller_id: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email: string
          id: string
          is_active?: boolean
          name: string
          role: Database["public"]["Enums"]["user_role"]
          seller_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
          seller_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      sellers: {
        Row: {
          company_id: string | null
          created_at: string
          first_name: string
          id: string
          is_active: boolean
          name: string
          profile_id: string | null
          team: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          first_name: string
          id?: string
          is_active?: boolean
          name: string
          profile_id?: string | null
          team?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          first_name?: string
          id?: string
          is_active?: boolean
          name?: string
          profile_id?: string | null
          team?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sellers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sellers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_lead_timeline_entry: {
        Args: {
          p_color: string
          p_detail?: string
          p_icon: string
          p_label: string
          p_lead_id: string
        }
        Returns: {
          actor_profile_id: string | null
          color: string
          company_id: string
          created_at: string
          detail: string | null
          icon: string
          id: string
          label: string
          lead_id: string
          occurred_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lead_timeline_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_lead_event: {
        Args: {
          p_event_type: Database["public"]["Enums"]["lead_event_type"]
          p_lead_id: string
        }
        Returns: {
          alert_label: string | null
          archived_at: string | null
          car: string
          company_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          last_activity_label: string | null
          name: string
          payment_preference: string | null
          phone: string
          phone_digits: string | null
          seller_id: string | null
          source: string | null
          stage_id: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at: string
          updated_by_profile_id: string | null
          urgency: Database["public"]["Enums"]["lead_urgency"]
          value_amount: number | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_lead: {
        Args: { p_expected_version: number; p_lead_id: string }
        Returns: {
          alert_label: string | null
          archived_at: string | null
          car: string
          company_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          last_activity_label: string | null
          name: string
          payment_preference: string | null
          phone: string
          phone_digits: string | null
          seller_id: string | null
          source: string | null
          stage_id: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at: string
          updated_by_profile_id: string | null
          urgency: Database["public"]["Enums"]["lead_urgency"]
          value_amount: number | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_lead_seller: {
        Args: {
          p_expected_version: number
          p_lead_id: string
          p_seller_id: string
        }
        Returns: {
          alert_label: string | null
          archived_at: string | null
          car: string
          company_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          last_activity_label: string | null
          name: string
          payment_preference: string | null
          phone: string
          phone_digits: string | null
          seller_id: string | null
          source: string | null
          stage_id: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at: string
          updated_by_profile_id: string | null
          urgency: Database["public"]["Enums"]["lead_urgency"]
          value_amount: number | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_lead_phone_duplicate: {
        Args: { p_phone: string }
        Returns: {
          lead_archived: boolean
          lead_id: string
          lead_name: string
          status: Database["public"]["Enums"]["lead_duplicate_status"]
        }[]
      }
      create_lead: {
        Args: {
          p_car: string
          p_name: string
          p_payment_preference?: string
          p_phone: string
          p_seller_id?: string
          p_source?: string
          p_temperature?: Database["public"]["Enums"]["lead_temperature"]
        }
        Returns: {
          alert_label: string | null
          archived_at: string | null
          car: string
          company_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          last_activity_label: string | null
          name: string
          payment_preference: string | null
          phone: string
          phone_digits: string | null
          seller_id: string | null
          source: string | null
          stage_id: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at: string
          updated_by_profile_id: string | null
          urgency: Database["public"]["Enums"]["lead_urgency"]
          value_amount: number | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_profile_company_id: { Args: never; Returns: string }
      current_profile_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_profile_seller_id: { Args: never; Returns: string }
      is_manager_or_admin: { Args: never; Returns: boolean }
      move_lead_to_stage: {
        Args: {
          p_expected_version?: number
          p_lead_id: string
          p_stage_id: string
        }
        Returns: {
          alert_label: string | null
          archived_at: string | null
          car: string
          company_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          last_activity_label: string | null
          name: string
          payment_preference: string | null
          phone: string
          phone_digits: string | null
          seller_id: string | null
          source: string | null
          stage_id: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at: string
          updated_by_profile_id: string | null
          urgency: Database["public"]["Enums"]["lead_urgency"]
          value_amount: number | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reorder_pipeline_stages: {
        Args: { p_ordered_ids: string[] }
        Returns: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_terminal: boolean
          name: string
          sort_order: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pipeline_stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      unarchive_lead: {
        Args: { p_expected_version: number; p_lead_id: string }
        Returns: {
          alert_label: string | null
          archived_at: string | null
          car: string
          company_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          last_activity_label: string | null
          name: string
          payment_preference: string | null
          phone: string
          phone_digits: string | null
          seller_id: string | null
          source: string | null
          stage_id: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at: string
          updated_by_profile_id: string | null
          urgency: Database["public"]["Enums"]["lead_urgency"]
          value_amount: number | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_lead: {
        Args: {
          p_car: string
          p_expected_version: number
          p_lead_id: string
          p_name: string
          p_payment_preference?: string
          p_phone: string
          p_source?: string
          p_temperature?: Database["public"]["Enums"]["lead_temperature"]
        }
        Returns: {
          alert_label: string | null
          archived_at: string | null
          car: string
          company_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          last_activity_label: string | null
          name: string
          payment_preference: string | null
          phone: string
          phone_digits: string | null
          seller_id: string | null
          source: string | null
          stage_id: string
          temperature: Database["public"]["Enums"]["lead_temperature"] | null
          updated_at: string
          updated_by_profile_id: string | null
          urgency: Database["public"]["Enums"]["lead_urgency"]
          value_amount: number | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      lead_duplicate_status: "none" | "accessible" | "restricted"
      lead_event_type:
        | "call_outcome_visit"
        | "call_outcome_proposal"
        | "call_outcome_callback"
        | "call_outcome_no_answer"
        | "visit_scheduled_complete"
        | "visit_scheduled_incomplete"
        | "visit_confirmed"
        | "visit_canceled"
        | "visit_rescheduled"
        | "deal_created_needs_approval"
        | "deal_created_direct"
        | "deal_approved"
        | "deal_rejected"
        | "sale_registered"
        | "sale_canceled"
        | "visit_result_done"
        | "visit_result_thinking"
        | "visit_result_no_interest"
      lead_temperature: "hot" | "warm" | "cold"
      lead_urgency: "red" | "amber" | "green"
      user_role: "admin" | "manager" | "seller"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      lead_duplicate_status: ["none", "accessible", "restricted"],
      lead_event_type: [
        "call_outcome_visit",
        "call_outcome_proposal",
        "call_outcome_callback",
        "call_outcome_no_answer",
        "visit_scheduled_complete",
        "visit_scheduled_incomplete",
        "visit_confirmed",
        "visit_canceled",
        "visit_rescheduled",
        "deal_created_needs_approval",
        "deal_created_direct",
        "deal_approved",
        "deal_rejected",
        "sale_registered",
        "sale_canceled",
        "visit_result_done",
        "visit_result_thinking",
        "visit_result_no_interest",
      ],
      lead_temperature: ["hot", "warm", "cold"],
      lead_urgency: ["red", "amber", "green"],
      user_role: ["admin", "manager", "seller"],
    },
  },
} as const
