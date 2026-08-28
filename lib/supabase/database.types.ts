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
      audit_log: {
        Row: {
          action: string
          actor_profile_id: string | null
          after_data: Json | null
          before_data: Json | null
          company_id: string | null
          entity_id: string | null
          entity_type: string
          id: string
          occurred_at: string
          origin: string | null
          reason: string | null
          result: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          company_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          occurred_at?: string
          origin?: string | null
          reason?: string | null
          result: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          company_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          occurred_at?: string
          origin?: string | null
          reason?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          cnpj: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          logo_path: string | null
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["company_status"]
          timezone: string
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          logo_path?: string | null
          name: string
          phone?: string | null
          status?: Database["public"]["Enums"]["company_status"]
          timezone?: string
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["company_status"]
          timezone?: string
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_memberships: {
        Row: {
          company_id: string
          created_at: string
          id: string
          invited_at: string | null
          is_active: boolean
          joined_at: string | null
          lifecycle_status: Database["public"]["Enums"]["membership_lifecycle_status"]
          profile_id: string
          role: Database["public"]["Enums"]["company_role"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          invited_at?: string | null
          is_active?: boolean
          joined_at?: string | null
          lifecycle_status?: Database["public"]["Enums"]["membership_lifecycle_status"]
          profile_id: string
          role: Database["public"]["Enums"]["company_role"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          invited_at?: string | null
          is_active?: boolean
          joined_at?: string | null
          lifecycle_status?: Database["public"]["Enums"]["membership_lifecycle_status"]
          profile_id?: string
          role?: Database["public"]["Enums"]["company_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_month_rows: {
        Row: {
          acknowledged_at: string | null
          company_id: string
          competition_month_id: string
          completed_visit_count: number
          id: string
          rank: number
          reward_amount_cents: number | null
          reward_text: string | null
          sale_count: number
          scheduled_visit_count: number
          seller_id: string
          seller_name_snapshot: string
        }
        Insert: {
          acknowledged_at?: string | null
          company_id: string
          competition_month_id: string
          completed_visit_count: number
          id?: string
          rank: number
          reward_amount_cents?: number | null
          reward_text?: string | null
          sale_count: number
          scheduled_visit_count: number
          seller_id: string
          seller_name_snapshot: string
        }
        Update: {
          acknowledged_at?: string | null
          company_id?: string
          competition_month_id?: string
          completed_visit_count?: number
          id?: string
          rank?: number
          reward_amount_cents?: number | null
          reward_text?: string | null
          sale_count?: number
          scheduled_visit_count?: number
          seller_id?: string
          seller_name_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_month_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_month_rows_competition_month_id_fkey"
            columns: ["competition_month_id"]
            isOneToOne: false
            referencedRelation: "competition_months"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_months: {
        Row: {
          campaign_id: string
          closed_at: string
          company_id: string
          had_competition: boolean
          id: string
          month_start: string
          period_end: string
          period_start: string
          timezone: string
        }
        Insert: {
          campaign_id: string
          closed_at?: string
          company_id: string
          had_competition: boolean
          id?: string
          month_start: string
          period_end: string
          period_start: string
          timezone: string
        }
        Update: {
          campaign_id?: string
          closed_at?: string
          company_id?: string
          had_competition?: boolean
          id?: string
          month_start?: string
          period_end?: string
          period_start?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_months_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "competition_reward_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_months_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_reward_campaigns: {
        Row: {
          company_id: string
          created_at: string
          created_by_profile_id: string
          id: string
          month_start: string
          published_at: string | null
          published_by_profile_id: string | null
          status: string
          timezone: string
          title: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by_profile_id: string
          id?: string
          month_start: string
          published_at?: string | null
          published_by_profile_id?: string | null
          status?: string
          timezone: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by_profile_id?: string
          id?: string
          month_start?: string
          published_at?: string | null
          published_by_profile_id?: string | null
          status?: string
          timezone?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_reward_campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_reward_campaigns_creator_fk"
            columns: ["company_id", "created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
        ]
      }
      competition_reward_tiers: {
        Row: {
          amount_cents: number | null
          campaign_id: string
          created_at: string
          id: string
          position: number
          reward_text: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          campaign_id: string
          created_at?: string
          id?: string
          position: number
          reward_text?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          campaign_id?: string
          created_at?: string
          id?: string
          position?: number
          reward_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_reward_tiers_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "competition_reward_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          assigned_seller_id: string
          client_name_snapshot: string
          company_id: string
          created_at: string
          created_by: string
          discount_percent: number
          down_payment_cents: number | null
          id: string
          installments: string | null
          lead_id: string
          lost_at: string | null
          lost_by: string | null
          note: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
          updated_by: string
          value_cents: number
          vehicle: string
          version: number
        }
        Insert: {
          assigned_seller_id: string
          client_name_snapshot: string
          company_id: string
          created_at?: string
          created_by: string
          discount_percent: number
          down_payment_cents?: number | null
          id?: string
          installments?: string | null
          lead_id: string
          lost_at?: string | null
          lost_by?: string | null
          note?: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          status?: Database["public"]["Enums"]["deal_status"]
          updated_at?: string
          updated_by: string
          value_cents: number
          vehicle: string
          version?: number
        }
        Update: {
          assigned_seller_id?: string
          client_name_snapshot?: string
          company_id?: string
          created_at?: string
          created_by?: string
          discount_percent?: number
          down_payment_cents?: number | null
          id?: string
          installments?: string | null
          lead_id?: string
          lost_at?: string | null
          lost_by?: string | null
          note?: string
          payment_method?: Database["public"]["Enums"]["deal_payment_method"]
          status?: Database["public"]["Enums"]["deal_status"]
          updated_at?: string
          updated_by?: string
          value_cents?: number
          vehicle?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_company_lead_fk"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "deals_company_seller_fk"
            columns: ["company_id", "assigned_seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "deals_created_by_fk"
            columns: ["company_id", "created_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
          {
            foreignKeyName: "deals_lost_by_fk"
            columns: ["company_id", "lost_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
          {
            foreignKeyName: "deals_updated_by_fk"
            columns: ["company_id", "updated_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
        ]
      }
      followup_templates: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          default_time: string | null
          id: string
          is_active: boolean
          name: string
          offset_unit: string
          offset_value: number
          priority: Database["public"]["Enums"]["task_priority"]
          sort_order: number
          task_note: string
          task_title: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          default_time?: string | null
          id?: string
          is_active?: boolean
          name: string
          offset_unit: string
          offset_value: number
          priority: Database["public"]["Enums"]["task_priority"]
          sort_order: number
          task_note?: string
          task_title: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          default_time?: string | null
          id?: string
          is_active?: boolean
          name?: string
          offset_unit?: string
          offset_value?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          sort_order?: number
          task_note?: string
          task_title?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "followup_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          actor_kind: string
          actor_profile_id: string | null
          client_request_id: string
          company_id: string
          completed_at: string
          created_at: string
          duplicate_count: number
          error_count: number
          filename: string
          id: string
          imported_count: number
          result_json: Json
          status: string
          total_rows: number
        }
        Insert: {
          actor_kind: string
          actor_profile_id?: string | null
          client_request_id: string
          company_id: string
          completed_at?: string
          created_at?: string
          duplicate_count: number
          error_count: number
          filename: string
          id?: string
          imported_count: number
          result_json: Json
          status: string
          total_rows: number
        }
        Update: {
          actor_kind?: string
          actor_profile_id?: string | null
          client_request_id?: string
          company_id?: string
          completed_at?: string
          created_at?: string
          duplicate_count?: number
          error_count?: number
          filename?: string
          id?: string
          imported_count?: number
          result_json?: Json
          status?: string
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_activation_rate_limit_events: {
        Row: {
          actor_profile_id: string | null
          dimension: string
          id: string
          invite_id: string | null
          key_hash: string
          occurred_at: string
        }
        Insert: {
          actor_profile_id?: string | null
          dimension: string
          id?: string
          invite_id?: string | null
          key_hash: string
          occurred_at?: string
        }
        Update: {
          actor_profile_id?: string | null
          dimension?: string
          id?: string
          invite_id?: string | null
          key_hash?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_activation_rate_limit_events_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_rate_limit_events: {
        Row: {
          actor_profile_id: string | null
          company_id: string | null
          email_normalized: string
          id: string
          occurred_at: string
          operation: string
        }
        Insert: {
          actor_profile_id?: string | null
          company_id?: string | null
          email_normalized: string
          id?: string
          occurred_at?: string
          operation: string
        }
        Update: {
          actor_profile_id?: string | null
          company_id?: string | null
          email_normalized?: string
          id?: string
          occurred_at?: string
          operation?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_rate_limit_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_rate_limit_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_profile_id: string | null
          company_id: string | null
          created_at: string
          delivery_attempted_at: string | null
          delivery_status: Database["public"]["Enums"]["invite_delivery_status"]
          email: string
          email_normalized: string | null
          email_sent_at: string | null
          expires_at: string
          id: string
          invited_by_profile_id: string | null
          last_delivery_error_code: string | null
          name: string
          role_kind: Database["public"]["Enums"]["invite_role_kind"]
          status: Database["public"]["Enums"]["invite_status"]
          supersedes_invite_id: string | null
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_profile_id?: string | null
          company_id?: string | null
          created_at?: string
          delivery_attempted_at?: string | null
          delivery_status?: Database["public"]["Enums"]["invite_delivery_status"]
          email: string
          email_normalized?: string | null
          email_sent_at?: string | null
          expires_at: string
          id?: string
          invited_by_profile_id?: string | null
          last_delivery_error_code?: string | null
          name: string
          role_kind: Database["public"]["Enums"]["invite_role_kind"]
          status?: Database["public"]["Enums"]["invite_status"]
          supersedes_invite_id?: string | null
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_profile_id?: string | null
          company_id?: string | null
          created_at?: string
          delivery_attempted_at?: string | null
          delivery_status?: Database["public"]["Enums"]["invite_delivery_status"]
          email?: string
          email_normalized?: string | null
          email_sent_at?: string | null
          expires_at?: string
          id?: string
          invited_by_profile_id?: string | null
          last_delivery_error_code?: string | null
          name?: string
          role_kind?: Database["public"]["Enums"]["invite_role_kind"]
          status?: Database["public"]["Enums"]["invite_status"]
          supersedes_invite_id?: string | null
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_profile_id_fkey"
            columns: ["accepted_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_invited_by_profile_id_fkey"
            columns: ["invited_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_supersedes_invite_id_fkey"
            columns: ["supersedes_invite_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
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
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
          {
            foreignKeyName: "leads_updated_by_fk"
            columns: ["company_id", "updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
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
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          platform_role: Database["public"]["Enums"]["platform_role"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          is_active?: boolean
          name: string
          platform_role?: Database["public"]["Enums"]["platform_role"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          platform_role?: Database["public"]["Enums"]["platform_role"] | null
          updated_at?: string
        }
        Relationships: []
      }
      sales: {
        Row: {
          assigned_seller_id: string
          company_id: string
          created_at: string
          deal_id: string
          id: string
          lead_id: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          sold_at: string
          sold_by: string
          sold_value_cents: number
        }
        Insert: {
          assigned_seller_id: string
          company_id: string
          created_at?: string
          deal_id: string
          id?: string
          lead_id: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          sold_at?: string
          sold_by: string
          sold_value_cents: number
        }
        Update: {
          assigned_seller_id?: string
          company_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          lead_id?: string
          payment_method?: Database["public"]["Enums"]["deal_payment_method"]
          sold_at?: string
          sold_by?: string
          sold_value_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_company_deal_fk"
            columns: ["company_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "sales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_company_lead_fk"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "sales_company_seller_fk"
            columns: ["company_id", "assigned_seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "sales_sold_by_fk"
            columns: ["company_id", "sold_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
        ]
      }
      seller_competition_events: {
        Row: {
          actor_profile_id: string
          company_id: string
          competition_started: boolean
          created_at: string
          event_type: string
          id: string
          new_rank: number
          old_rank: number
          period_end: string
          period_start: string
          related_seller_id: string | null
          sale_count: number
          seen_at: string | null
          seller_id: string
          source_appointment_visit_id: string | null
          source_sale_id: string | null
          source_type: string
          source_visit_id: string | null
        }
        Insert: {
          actor_profile_id: string
          company_id: string
          competition_started?: boolean
          created_at?: string
          event_type?: string
          id?: string
          new_rank: number
          old_rank: number
          period_end: string
          period_start: string
          related_seller_id?: string | null
          sale_count: number
          seen_at?: string | null
          seller_id: string
          source_appointment_visit_id?: string | null
          source_sale_id?: string | null
          source_type: string
          source_visit_id?: string | null
        }
        Update: {
          actor_profile_id?: string
          company_id?: string
          competition_started?: boolean
          created_at?: string
          event_type?: string
          id?: string
          new_rank?: number
          old_rank?: number
          period_end?: string
          period_start?: string
          related_seller_id?: string | null
          sale_count?: number
          seen_at?: string | null
          seller_id?: string
          source_appointment_visit_id?: string | null
          source_sale_id?: string | null
          source_type?: string
          source_visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_competition_events_actor_fk"
            columns: ["company_id", "actor_profile_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
          {
            foreignKeyName: "seller_competition_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_competition_events_company_related_seller_fk"
            columns: ["company_id", "related_seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "seller_competition_events_company_seller_fk"
            columns: ["company_id", "seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "seller_competition_events_source_appointment_visit_id_fkey"
            columns: ["source_appointment_visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_competition_events_source_sale_fk"
            columns: ["source_sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_competition_events_source_visit_id_fkey"
            columns: ["source_visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
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
          membership_id: string | null
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
          membership_id?: string | null
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
          membership_id?: string | null
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
            foreignKeyName: "sellers_membership_company_fk"
            columns: ["company_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "id"]
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
      tasks: {
        Row: {
          assigned_seller_id: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          lead_id: string | null
          note: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          assigned_seller_id?: string | null
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_at: string
          id?: string
          lead_id?: string | null
          note?: string
          priority: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          assigned_seller_id?: string | null
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          lead_id?: string | null
          note?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_company_lead_fk"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "tasks_company_seller_fk"
            columns: ["company_id", "assigned_seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fk"
            columns: ["company_id", "completed_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fk"
            columns: ["company_id", "created_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
          {
            foreignKeyName: "tasks_updated_by_fk"
            columns: ["company_id", "updated_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
        ]
      }
      visits: {
        Row: {
          assigned_seller_id: string
          client_name: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          note: string
          outcome: Database["public"]["Enums"]["visit_outcome"] | null
          result_note: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
          updated_by: string | null
          vehicles: string[]
          version: number
        }
        Insert: {
          assigned_seller_id: string
          client_name?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          note?: string
          outcome?: Database["public"]["Enums"]["visit_outcome"] | null
          result_note?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["visit_status"]
          updated_at?: string
          updated_by?: string | null
          vehicles: string[]
          version?: number
        }
        Update: {
          assigned_seller_id?: string
          client_name?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          note?: string
          outcome?: Database["public"]["Enums"]["visit_outcome"] | null
          result_note?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["visit_status"]
          updated_at?: string
          updated_by?: string | null
          vehicles?: string[]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "visits_closed_by_fk"
            columns: ["company_id", "closed_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
          {
            foreignKeyName: "visits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_company_lead_fk"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "visits_company_seller_fk"
            columns: ["company_id", "assigned_seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "visits_created_by_fk"
            columns: ["company_id", "created_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
          {
            foreignKeyName: "visits_updated_by_fk"
            columns: ["company_id", "updated_by"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "profile_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _finalize_due_competition_reward_months: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      _followup_template_active_count: {
        Args: { p_company_id: string }
        Returns: number
      }
      _followup_template_active_limit: { Args: never; Returns: number }
      _lock_company_and_resolve_official_period: {
        Args: { p_company_id: string }
        Returns: {
          period_end: string
          period_start: string
        }[]
      }
      _rank_company_sellers: {
        Args: {
          p_company_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: Database["public"]["CompositeTypes"]["seller_rank_row"][]
        SetofOptions: {
          from: "*"
          to: "seller_rank_row"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      _rank_company_sellers_snapshot: {
        Args: {
          p_company_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: Database["public"]["CompositeTypes"]["seller_rank_row"][]
        SetofOptions: {
          from: "*"
          to: "seller_rank_row"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      _resolve_commercial_read_company: {
        Args: { p_company_id: string }
        Returns: string
      }
      accept_invite: {
        Args: { p_token_hash: string }
        Returns: {
          code: string
          company_id: string
          invite_id: string
          retry_after_seconds: number
          role_kind: Database["public"]["Enums"]["invite_role_kind"]
          success: boolean
        }[]
      }
      acknowledge_competition_month_result: {
        Args: { p_competition_month_id: string }
        Returns: number
      }
      activate_company: {
        Args: { p_company_id: string }
        Returns: {
          cnpj: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          logo_path: string | null
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["company_status"]
          timezone: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_lead_timeline_entry: {
        Args: {
          p_color: string
          p_company_id?: string
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
          p_company_id?: string
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
        Args: {
          p_company_id?: string
          p_expected_version: number
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
      assign_lead_seller: {
        Args: {
          p_company_id?: string
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
      bulk_import_leads: {
        Args: {
          p_car_fallback_enabled: boolean
          p_client_request_id: string
          p_company_id?: string
          p_dry_run: boolean
          p_filename: string
          p_rows: Json
        }
        Returns: Json
      }
      can_access_company: {
        Args: { p_target_company_id: string }
        Returns: boolean
      }
      cancel_invite: {
        Args: { p_invite_id: string }
        Returns: {
          code: string
          invite_id: string
          status: Database["public"]["Enums"]["invite_status"]
          success: boolean
        }[]
      }
      cancel_visit: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          assigned_seller_id: string
          client_name: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          note: string
          outcome: Database["public"]["Enums"]["visit_outcome"] | null
          result_note: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
          updated_by: string | null
          vehicles: string[]
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_lead_phone_duplicate: {
        Args: {
          p_company_id?: string
          p_exclude_lead_id?: string
          p_phone: string
        }
        Returns: {
          lead_archived: boolean
          lead_id: string
          lead_name: string
          status: Database["public"]["Enums"]["lead_duplicate_status"]
        }[]
      }
      commit_profile_email_update: {
        Args: {
          p_expected_email: string
          p_new_email: string
          p_target_profile_id: string
        }
        Returns: {
          email: string
          profile_id: string
          updated_at: string
        }[]
      }
      complete_invite_delivery: {
        Args: {
          p_actor_profile_id: string
          p_error_code?: string
          p_invite_id: string
          p_success: boolean
        }
        Returns: {
          code: string
          success: boolean
        }[]
      }
      complete_invite_resend_delivery: {
        Args: {
          p_actor_profile_id: string
          p_error_code?: string
          p_invite_id: string
          p_previous_invite_id: string
          p_success: boolean
        }
        Returns: {
          code: string
          success: boolean
        }[]
      }
      complete_task: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          assigned_seller_id: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          lead_id: string | null
          note: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_visit: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          assigned_seller_id: string
          client_name: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          note: string
          outcome: Database["public"]["Enums"]["visit_outcome"] | null
          result_note: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
          updated_by: string | null
          vehicles: string[]
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_company: {
        Args: {
          p_cnpj?: string
          p_name: string
          p_phone?: string
          p_timezone?: string
          p_trade_name?: string
        }
        Returns: {
          cnpj: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          logo_path: string | null
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["company_status"]
          timezone: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_deal: {
        Args: {
          p_assigned_seller_id?: string
          p_discount_percent: number
          p_down_payment_cents?: number
          p_installments?: string
          p_lead_id: string
          p_note?: string
          p_payment_method: Database["public"]["Enums"]["deal_payment_method"]
          p_value_cents: number
          p_vehicle: string
        }
        Returns: {
          assigned_seller_id: string
          client_name_snapshot: string
          company_id: string
          created_at: string
          created_by: string
          discount_percent: number
          down_payment_cents: number | null
          id: string
          installments: string | null
          lead_id: string
          lost_at: string | null
          lost_by: string | null
          note: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
          updated_by: string
          value_cents: number
          vehicle: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_followup_template: {
        Args: {
          p_company_id?: string
          p_default_time?: string
          p_name: string
          p_offset_unit: string
          p_offset_value: number
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_sort_order?: number
          p_task_note?: string
          p_task_title: string
        }
        Returns: {
          company_id: string
          created_at: string
          created_by: string
          default_time: string | null
          id: string
          is_active: boolean
          name: string
          offset_unit: string
          offset_value: number
          priority: Database["public"]["Enums"]["task_priority"]
          sort_order: number
          task_note: string
          task_title: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "followup_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invite: {
        Args: {
          p_actor_profile_id: string
          p_company_id: string
          p_email: string
          p_name: string
          p_role_kind: Database["public"]["Enums"]["invite_role_kind"]
          p_token_hash: string
        }
        Returns: {
          code: string
          expires_at: string
          invite_id: string
          status: Database["public"]["Enums"]["invite_status"]
          success: boolean
        }[]
      }
      create_lead: {
        Args: {
          p_car: string
          p_company_id?: string
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
      create_task: {
        Args: {
          p_assigned_seller_id?: string
          p_due_at: string
          p_lead_id?: string
          p_note?: string
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_title: string
        }
        Returns: {
          assigned_seller_id: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          lead_id: string | null
          note: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_visit: {
        Args: {
          p_assigned_seller_id?: string
          p_client_name?: string
          p_lead_id?: string
          p_note?: string
          p_scheduled_at: string
          p_vehicles: string[]
        }
        Returns: {
          assigned_seller_id: string
          client_name: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          note: string
          outcome: Database["public"]["Enums"]["visit_outcome"] | null
          result_note: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
          updated_by: string | null
          vehicles: string[]
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_membership_company_id: { Args: never; Returns: string }
      current_membership_role: {
        Args: never
        Returns: Database["public"]["Enums"]["company_role"]
      }
      current_profile_seller_id_for_company: {
        Args: { p_target_company_id: string }
        Returns: string
      }
      get_auth_email_update_state: {
        Args: { p_new_email: string; p_target_user_id: string }
        Returns: {
          current_email: string
          new_email_in_use: boolean
        }[]
      }
      get_company_management_report: {
        Args: {
          p_company_id?: string
          p_period_end: string
          p_period_start: string
        }
        Returns: Json
      }
      get_competition_reward_campaign: {
        Args: { p_company_id?: string; p_month_start: string }
        Returns: Json
      }
      get_competition_rewards_overview: {
        Args: { p_company_id?: string }
        Returns: Json
      }
      get_profile_email_update_state: {
        Args: { p_new_email: string; p_target_profile_id: string }
        Returns: {
          company_id: string
          company_status: Database["public"]["Enums"]["company_status"]
          current_email: string
          membership_is_active: boolean
          new_email_in_use: boolean
          platform_role: Database["public"]["Enums"]["platform_role"]
          profile_exists: boolean
          profile_is_active: boolean
        }[]
      }
      insert_lead_row: {
        Args: {
          p_actor_kind: string
          p_actor_profile_id: string
          p_car: string
          p_company_id: string
          p_name: string
          p_payment_preference: string
          p_phone: string
          p_seller_id: string
          p_source: string
          p_stage_id: string
          p_temperature: Database["public"]["Enums"]["lead_temperature"]
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
      is_manager_or_platform: {
        Args: { p_target_company_id: string }
        Returns: boolean
      }
      is_platform_super_admin: { Args: never; Returns: boolean }
      list_commercial_companies: {
        Args: never
        Returns: {
          id: string
          name: string
          status: Database["public"]["Enums"]["company_status"]
        }[]
      }
      list_company_seller_leaderboard: {
        Args: {
          p_company_id?: string
          p_period_end: string
          p_period_start: string
        }
        Returns: {
          completed_visit_count: number
          movement_happened_at: string
          movement_positions_gained: number
          rank: number
          sale_count: number
          scheduled_visit_count: number
          seller_id: string
          seller_label: string
        }[]
      }
      list_company_users: {
        Args: {
          p_company_id?: string
          p_cursor_created_at?: string
          p_cursor_membership_id?: string
          p_limit?: number
          p_role?: Database["public"]["Enums"]["company_role"]
          p_search?: string
        }
        Returns: {
          company_id: string
          company_name: string
          company_role: Database["public"]["Enums"]["company_role"]
          created_at: string
          email: string
          membership_id: string
          name: string
          profile_id: string
        }[]
      }
      list_competition_reward_history: {
        Args: { p_company_id?: string; p_limit?: number }
        Returns: Json
      }
      list_current_company_assignable_sellers: {
        Args: never
        Returns: {
          name: string
          seller_id: string
        }[]
      }
      list_current_company_seller_labels: {
        Args: never
        Returns: {
          name: string
          seller_id: string
        }[]
      }
      list_inactive_company_users: {
        Args: {
          p_company_id?: string
          p_cursor_membership_id?: string
          p_cursor_updated_at?: string
          p_lifecycle?: Database["public"]["Enums"]["membership_lifecycle_status"]
          p_limit?: number
          p_role?: Database["public"]["Enums"]["company_role"]
          p_search?: string
        }
        Returns: {
          company_id: string
          company_name: string
          company_role: Database["public"]["Enums"]["company_role"]
          created_at: string
          email: string
          is_active: boolean
          lifecycle_status: Database["public"]["Enums"]["membership_lifecycle_status"]
          membership_id: string
          name: string
          profile_id: string
          updated_at: string
        }[]
      }
      list_my_unseen_competition_events: {
        Args: never
        Returns: {
          competition_started: boolean
          created_at: string
          event_type: string
          id: string
          new_rank: number
          old_rank: number
          period_end: string
          period_start: string
          related_seller_id: string
          related_seller_label: string
          sale_count: number
          source_type: string
        }[]
      }
      list_pipeline_stages_for_company: {
        Args: { p_company_id: string }
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
      list_platform_deals_for_company: {
        Args: { p_company_id: string }
        Returns: {
          assigned_seller_id: string
          client_name_snapshot: string
          company_id: string
          created_at: string
          created_by: string
          discount_percent: number
          down_payment_cents: number | null
          id: string
          installments: string | null
          lead_id: string
          lost_at: string | null
          lost_by: string | null
          note: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
          updated_by: string
          value_cents: number
          vehicle: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_platform_followup_templates_for_company: {
        Args: { p_company_id: string; p_include_inactive?: boolean }
        Returns: {
          company_id: string
          created_at: string
          created_by: string
          default_time: string | null
          id: string
          is_active: boolean
          name: string
          offset_unit: string
          offset_value: number
          priority: Database["public"]["Enums"]["task_priority"]
          sort_order: number
          task_note: string
          task_title: string
          updated_at: string
          updated_by: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "followup_templates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_platform_lead_timeline: {
        Args: { p_company_id: string; p_lead_id: string }
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
        }[]
        SetofOptions: {
          from: "*"
          to: "lead_timeline_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_platform_leads_for_company: {
        Args: { p_archived?: boolean; p_company_id: string }
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
        }[]
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_platform_sales_for_company: {
        Args: { p_company_id: string }
        Returns: {
          assigned_seller_id: string
          company_id: string
          created_at: string
          deal_id: string
          id: string
          lead_id: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          sold_at: string
          sold_by: string
          sold_value_cents: number
        }[]
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_platform_sellers_for_company: {
        Args: { p_company_id: string }
        Returns: {
          name: string
          seller_id: string
        }[]
      }
      list_platform_tasks_for_company: {
        Args: { p_company_id: string }
        Returns: {
          assigned_seller_id: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          lead_id: string | null
          note: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_platform_visits_for_company: {
        Args: { p_company_id: string }
        Returns: {
          assigned_seller_id: string
          client_name: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          note: string
          outcome: Database["public"]["Enums"]["visit_outcome"] | null
          result_note: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
          updated_by: string | null
          vehicles: string[]
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "visits"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_competition_events_seen: {
        Args: { p_event_ids: string[] }
        Returns: number
      }
      mark_deal_lost: {
        Args: { p_expected_version: number; p_id: string }
        Returns: {
          assigned_seller_id: string
          client_name_snapshot: string
          company_id: string
          created_at: string
          created_by: string
          discount_percent: number
          down_payment_cents: number | null
          id: string
          installments: string | null
          lead_id: string
          lost_at: string | null
          lost_by: string | null
          note: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
          updated_by: string
          value_cents: number
          vehicle: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      move_lead_to_stage: {
        Args: {
          p_company_id?: string
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
      offboard_manager: {
        Args: {
          p_manager_membership_id: string
          p_note: string
          p_successor_profile_id: string
        }
        Returns: {
          company_id: string
          company_role: Database["public"]["Enums"]["company_role"]
          is_active: boolean
          lifecycle_status: Database["public"]["Enums"]["membership_lifecycle_status"]
          membership_id: string
          profile_id: string
          successor_profile_id: string
        }[]
      }
      offboard_seller: {
        Args: {
          p_note: string
          p_seller_membership_id: string
          p_successor_membership_id: string
        }
        Returns: {
          company_id: string
          company_role: Database["public"]["Enums"]["company_role"]
          is_active: boolean
          leads_reassigned: number
          lifecycle_status: Database["public"]["Enums"]["membership_lifecycle_status"]
          membership_id: string
          profile_id: string
          seller_active: boolean
          seller_id: string
          successor_seller_id: string
        }[]
      }
      reactivate_membership: {
        Args: { p_membership_id: string; p_note?: string }
        Returns: {
          company_id: string
          company_role: Database["public"]["Enums"]["company_role"]
          is_active: boolean
          lifecycle_status: Database["public"]["Enums"]["membership_lifecycle_status"]
          membership_id: string
          profile_id: string
          seller_active: boolean
          seller_id: string
        }[]
      }
      record_lead_timeline_event: {
        Args: {
          p_actor_kind: string
          p_actor_profile_id: string
          p_color: string
          p_company_id: string
          p_detail?: string
          p_icon: string
          p_label: string
          p_lead_id: string
        }
        Returns: undefined
      }
      register_sale: {
        Args: {
          p_deal_id: string
          p_expected_version: number
          p_payment_method: Database["public"]["Enums"]["deal_payment_method"]
          p_sold_value_cents: number
        }
        Returns: {
          assigned_seller_id: string
          client_name_snapshot: string
          company_id: string
          created_at: string
          created_by: string
          discount_percent: number
          down_payment_cents: number | null
          id: string
          installments: string | null
          lead_id: string
          lost_at: string | null
          lost_by: string | null
          note: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
          updated_by: string
          value_cents: number
          vehicle: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_visit_result: {
        Args: {
          p_expected_version: number
          p_id: string
          p_outcome: Database["public"]["Enums"]["visit_outcome"]
          p_result_note?: string
        }
        Returns: {
          assigned_seller_id: string
          client_name: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          note: string
          outcome: Database["public"]["Enums"]["visit_outcome"] | null
          result_note: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
          updated_by: string | null
          vehicles: string[]
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reorder_followup_templates: {
        Args: { p_company_id?: string; p_ordered_ids: string[] }
        Returns: {
          company_id: string
          created_at: string
          created_by: string
          default_time: string | null
          id: string
          is_active: boolean
          name: string
          offset_unit: string
          offset_value: number
          priority: Database["public"]["Enums"]["task_priority"]
          sort_order: number
          task_note: string
          task_title: string
          updated_at: string
          updated_by: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "followup_templates"
          isOneToOne: false
          isSetofReturn: true
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
      require_company_access: {
        Args: { p_target_company_id: string }
        Returns: string
      }
      resend_invite: {
        Args: {
          p_actor_profile_id: string
          p_invite_id: string
          p_token_hash: string
        }
        Returns: {
          code: string
          expires_at: string
          invite_id: string
          previous_invite_id: string
          status: Database["public"]["Enums"]["invite_status"]
          success: boolean
        }[]
      }
      reserve_create_invite_rate_limit: {
        Args: {
          p_actor_profile_id: string
          p_company_id: string
          p_email: string
          p_role_kind: Database["public"]["Enums"]["invite_role_kind"]
        }
        Returns: {
          allowed: boolean
          code: string
          retry_after_seconds: number
        }[]
      }
      reserve_invite_rate_limit: {
        Args: {
          p_actor_profile_id: string
          p_company_id: string
          p_email: string
          p_operation: string
        }
        Returns: {
          allowed: boolean
          code: string
          retry_after_seconds: number
        }[]
      }
      reserve_invite_validation_rate_limit: {
        Args: { p_ip_hash: string; p_token_hash: string }
        Returns: {
          allowed: boolean
          code: string
          retry_after_seconds: number
        }[]
      }
      reserve_resend_invite_rate_limit: {
        Args: { p_actor_profile_id: string; p_invite_id: string }
        Returns: {
          allowed: boolean
          code: string
          retry_after_seconds: number
        }[]
      }
      resolve_commercial_mutation_context: {
        Args: never
        Returns: {
          actor_kind: string
          actor_profile_id: string
          actor_seller_id: string
          company_status: Database["public"]["Enums"]["company_status"]
          resolved_company_id: string
        }[]
      }
      resolve_followup_template_mutation_context: {
        Args: { p_company_id?: string }
        Returns: {
          actor_kind: string
          actor_profile_id: string
          company_status: Database["public"]["Enums"]["company_status"]
          resolved_company_id: string
        }[]
      }
      resolve_lead_mutation_context: {
        Args: { p_company_id?: string; p_read_only?: boolean }
        Returns: {
          actor_kind: string
          actor_profile_id: string
          actor_seller_id: string
          company_status: Database["public"]["Enums"]["company_status"]
          resolved_company_id: string
        }[]
      }
      set_followup_template_active: {
        Args: {
          p_company_id?: string
          p_expected_version: number
          p_id: string
          p_is_active: boolean
        }
        Returns: {
          company_id: string
          created_at: string
          created_by: string
          default_time: string | null
          id: string
          is_active: boolean
          name: string
          offset_unit: string
          offset_value: number
          priority: Database["public"]["Enums"]["task_priority"]
          sort_order: number
          task_note: string
          task_title: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "followup_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      suspend_membership: {
        Args: { p_membership_id: string; p_note: string }
        Returns: {
          company_id: string
          company_role: Database["public"]["Enums"]["company_role"]
          is_active: boolean
          lifecycle_status: Database["public"]["Enums"]["membership_lifecycle_status"]
          membership_id: string
          profile_id: string
          seller_active: boolean
          seller_id: string
        }[]
      }
      transfer_membership: {
        Args: {
          p_note: string
          p_source_membership_id: string
          p_successor_id: string
          p_target_company_id: string
          p_target_role: Database["public"]["Enums"]["company_role"]
        }
        Returns: {
          destination_company_id: string
          destination_membership_id: string
          destination_role: Database["public"]["Enums"]["company_role"]
          destination_seller_id: string
          leads_reassigned: number
          profile_id: string
          source_company_id: string
          source_membership_id: string
          source_seller_id: string
        }[]
      }
      unarchive_lead: {
        Args: {
          p_company_id?: string
          p_expected_version: number
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
      update_company_logo: {
        Args: { p_company_id: string; p_logo_path: string }
        Returns: {
          cnpj: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          logo_path: string | null
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["company_status"]
          timezone: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_company_settings: {
        Args: { p_company_id: string; p_phone: string; p_timezone: string }
        Returns: {
          cnpj: string | null
          created_at: string
          created_by_profile_id: string | null
          id: string
          logo_path: string | null
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["company_status"]
          timezone: string
          trade_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_deal: {
        Args: {
          p_assigned_seller_id?: string
          p_discount_percent: number
          p_down_payment_cents?: number
          p_expected_version: number
          p_id: string
          p_installments?: string
          p_note?: string
          p_payment_method: Database["public"]["Enums"]["deal_payment_method"]
          p_value_cents: number
          p_vehicle: string
        }
        Returns: {
          assigned_seller_id: string
          client_name_snapshot: string
          company_id: string
          created_at: string
          created_by: string
          discount_percent: number
          down_payment_cents: number | null
          id: string
          installments: string | null
          lead_id: string
          lost_at: string | null
          lost_by: string | null
          note: string
          payment_method: Database["public"]["Enums"]["deal_payment_method"]
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
          updated_by: string
          value_cents: number
          vehicle: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_followup_template: {
        Args: {
          p_company_id?: string
          p_default_time: string
          p_expected_version: number
          p_id: string
          p_name: string
          p_offset_unit: string
          p_offset_value: number
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_task_note: string
          p_task_title: string
        }
        Returns: {
          company_id: string
          created_at: string
          created_by: string
          default_time: string | null
          id: string
          is_active: boolean
          name: string
          offset_unit: string
          offset_value: number
          priority: Database["public"]["Enums"]["task_priority"]
          sort_order: number
          task_note: string
          task_title: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "followup_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_lead: {
        Args: {
          p_car: string
          p_company_id?: string
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
      update_membership_role: {
        Args: {
          p_company_id: string
          p_membership_id: string
          p_role: Database["public"]["Enums"]["company_role"]
        }
        Returns: {
          company_id: string
          company_role: Database["public"]["Enums"]["company_role"]
          membership_id: string
          profile_id: string
        }[]
      }
      update_profile_name: {
        Args: { p_name: string; p_target_profile_id: string }
        Returns: {
          name: string
          profile_id: string
          updated_at: string
        }[]
      }
      update_task: {
        Args: {
          p_assigned_seller_id: string
          p_due_at: string
          p_expected_version: number
          p_id: string
          p_note: string
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_title: string
        }
        Returns: {
          assigned_seller_id: string | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          lead_id: string | null
          note: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_visit: {
        Args: {
          p_assigned_seller_id: string
          p_expected_version: number
          p_id: string
          p_note: string
          p_scheduled_at: string
          p_vehicles: string[]
        }
        Returns: {
          assigned_seller_id: string
          client_name: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          note: string
          outcome: Database["public"]["Enums"]["visit_outcome"] | null
          result_note: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
          updated_by: string | null
          vehicles: string[]
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_competition_reward_campaign: {
        Args: {
          p_month_start: string
          p_status: string
          p_tiers: Json
          p_title: string
        }
        Returns: {
          company_id: string
          created_at: string
          created_by_profile_id: string
          id: string
          month_start: string
          published_at: string | null
          published_by_profile_id: string | null
          status: string
          timezone: string
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "competition_reward_campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      validate_invite_token: {
        Args: { p_token_hash: string }
        Returns: {
          code: string
          masked_email: string
          valid: boolean
        }[]
      }
      visits_vehicles_valid: {
        Args: { p_vehicles: string[] }
        Returns: boolean
      }
    }
    Enums: {
      company_role: "manager" | "seller"
      company_status: "implantacao" | "ativa" | "suspensa" | "cancelada"
      deal_payment_method:
        | "a_vista"
        | "financiamento_100"
        | "entrada_financiamento"
        | "troca"
      deal_status: "open" | "lost" | "sold"
      invite_delivery_status: "not_sent" | "sent" | "failed"
      invite_role_kind: "super_admin" | "manager" | "seller"
      invite_status:
        | "pending"
        | "accepted"
        | "expired"
        | "canceled"
        | "superseded"
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
      membership_lifecycle_status: "active" | "suspended" | "offboarded"
      platform_role: "super_admin"
      task_priority: "alta" | "media" | "baixa"
      task_status: "pending" | "completed"
      user_role: "admin" | "manager" | "seller"
      visit_outcome: "sold" | "negotiating" | "thinking" | "no_interest"
      visit_status: "scheduled" | "confirmed" | "canceled" | "completed"
    }
    CompositeTypes: {
      seller_rank_row: {
        seller_id: string | null
        seller_label: string | null
        sale_count: number | null
        completed_visit_count: number | null
        scheduled_visit_count: number | null
        rank: number | null
      }
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
      company_role: ["manager", "seller"],
      company_status: ["implantacao", "ativa", "suspensa", "cancelada"],
      deal_payment_method: [
        "a_vista",
        "financiamento_100",
        "entrada_financiamento",
        "troca",
      ],
      deal_status: ["open", "lost", "sold"],
      invite_delivery_status: ["not_sent", "sent", "failed"],
      invite_role_kind: ["super_admin", "manager", "seller"],
      invite_status: [
        "pending",
        "accepted",
        "expired",
        "canceled",
        "superseded",
      ],
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
      membership_lifecycle_status: ["active", "suspended", "offboarded"],
      platform_role: ["super_admin"],
      task_priority: ["alta", "media", "baixa"],
      task_status: ["pending", "completed"],
      user_role: ["admin", "manager", "seller"],
      visit_outcome: ["sold", "negotiating", "thinking", "no_interest"],
      visit_status: ["scheduled", "confirmed", "canceled", "completed"],
    },
  },
} as const

