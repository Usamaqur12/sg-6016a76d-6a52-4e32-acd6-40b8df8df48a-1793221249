/* eslint-disable @typescript-eslint/no-empty-object-type */
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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          message: string
          priority: number
          starts_at: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          message: string
          priority?: number
          starts_at?: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          message?: string
          priority?: number
          starts_at?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          admin_id: string
          changes: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_id: string
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      background_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          dedupe_key: string | null
          error_message: string | null
          id: string
          job_type: string
          max_retries: number
          payload: Json
          priority: number
          result: Json | null
          retry_count: number
          scheduled_at: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          error_message?: string | null
          id?: string
          job_type: string
          max_retries?: number
          payload?: Json
          priority?: number
          result?: Json | null
          retry_count?: number
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          error_message?: string | null
          id?: string
          job_type?: string
          max_retries?: number
          payload?: Json
          priority?: number
          result?: Json | null
          retry_count?: number
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      bet_selections: {
        Row: {
          bet_id: string
          created_at: string
          event_id: string
          id: string
          market_id: string
          odds_id: string
          odds_value: number
          result: string
          selection: string
        }
        Insert: {
          bet_id: string
          created_at?: string
          event_id: string
          id?: string
          market_id: string
          odds_id: string
          odds_value: number
          result?: string
          selection: string
        }
        Update: {
          bet_id?: string
          created_at?: string
          event_id?: string
          id?: string
          market_id?: string
          odds_id?: string
          odds_value?: number
          result?: string
          selection?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_selections_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_selections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_selections_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_selections_odds_id_fkey"
            columns: ["odds_id"]
            isOneToOne: false
            referencedRelation: "odds"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_validations: {
        Row: {
          balance_at_validation: number | null
          bet_id: string | null
          created_at: string
          event_status_at_validation: string | null
          id: string
          market_status_at_validation: string | null
          odds_at_validation: number | null
          odds_requested: number
          rejection_reason: string | null
          stake_requested: number
          user_id: string
          validation_result: string
        }
        Insert: {
          balance_at_validation?: number | null
          bet_id?: string | null
          created_at?: string
          event_status_at_validation?: string | null
          id?: string
          market_status_at_validation?: string | null
          odds_at_validation?: number | null
          odds_requested: number
          rejection_reason?: string | null
          stake_requested: number
          user_id: string
          validation_result: string
        }
        Update: {
          balance_at_validation?: number | null
          bet_id?: string | null
          created_at?: string
          event_status_at_validation?: string | null
          id?: string
          market_status_at_validation?: string | null
          odds_at_validation?: number | null
          odds_requested?: number
          rejection_reason?: string | null
          stake_requested?: number
          user_id?: string
          validation_result?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_validations_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_validations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bets: {
        Row: {
          created_at: string
          id: string
          payout: number | null
          potential_return: number
          settled_at: string | null
          stake: number
          status: string
          total_odds: number
          type: string
          user_id: string
          wallet_transaction_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          payout?: number | null
          potential_return: number
          settled_at?: string | null
          stake: number
          status?: string
          total_odds: number
          type: string
          user_id: string
          wallet_transaction_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          payout?: number | null
          potential_return?: number
          settled_at?: string | null
          stake?: number
          status?: string
          total_odds?: number
          type?: string
          user_id?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bets_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      cashout_offers: {
        Row: {
          accepted_at: string | null
          bet_id: string
          cashout_amount: number
          cashout_percentage: number
          created_at: string
          current_odds: number
          expires_at: string
          id: string
          is_available: boolean
          offer_type: string
          original_odds: number
          original_stake: number
          user_id: string
          wallet_transaction_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          bet_id: string
          cashout_amount: number
          cashout_percentage: number
          created_at?: string
          current_odds: number
          expires_at?: string
          id?: string
          is_available?: boolean
          offer_type: string
          original_odds: number
          original_stake: number
          user_id: string
          wallet_transaction_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          bet_id?: string
          cashout_amount?: number
          cashout_percentage?: number
          created_at?: string
          current_odds?: number
          expires_at?: string
          id?: string
          is_available?: boolean
          offer_type?: string
          original_odds?: number
          original_stake?: number
          user_id?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cashout_offers_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashout_offers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashout_offers_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      event_exposure: {
        Row: {
          away_liability: number
          bet_count: number
          created_at: string
          draw_liability: number
          event_id: string
          home_liability: number
          id: string
          last_bet_at: string | null
          max_potential_payout: number
          risk_level: string
          total_liability: number
          total_stake: number
          unique_users: number
          updated_at: string
        }
        Insert: {
          away_liability?: number
          bet_count?: number
          created_at?: string
          draw_liability?: number
          event_id: string
          home_liability?: number
          id?: string
          last_bet_at?: string | null
          max_potential_payout?: number
          risk_level?: string
          total_liability?: number
          total_stake?: number
          unique_users?: number
          updated_at?: string
        }
        Update: {
          away_liability?: number
          bet_count?: number
          created_at?: string
          draw_liability?: number
          event_id?: string
          home_liability?: number
          id?: string
          last_bet_at?: string | null
          max_potential_payout?: number
          risk_level?: string
          total_liability?: number
          total_stake?: number
          unique_users?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_exposure_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          away_team: string
          created_at: string
          home_team: string
          id: string
          is_featured: boolean
          is_suspended: boolean
          league_id: string | null
          live_minute: number | null
          live_score_away: number | null
          live_score_home: number | null
          metadata: Json
          provider_event_id: string | null
          sport_id: string
          start_time: string
          status: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          away_team: string
          created_at?: string
          home_team: string
          id?: string
          is_featured?: boolean
          is_suspended?: boolean
          league_id?: string | null
          live_minute?: number | null
          live_score_away?: number | null
          live_score_home?: number | null
          metadata?: Json
          provider_event_id?: string | null
          sport_id: string
          start_time: string
          status?: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          away_team?: string
          created_at?: string
          home_team?: string
          id?: string
          is_featured?: boolean
          is_suspended?: boolean
          league_id?: string | null
          live_minute?: number | null
          live_score_away?: number | null
          live_score_home?: number | null
          metadata?: Json
          provider_event_id?: string | null
          sport_id?: string
          start_time?: string
          status?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_updates: {
        Row: {
          event_id: string | null
          id: string
          payload: Json
          provider_id: string
          received_at: string
          update_id: string
        }
        Insert: {
          event_id?: string | null
          id?: string
          payload: Json
          provider_id: string
          received_at?: string
          update_id: string
        }
        Update: {
          event_id?: string | null
          id?: string
          payload?: Json
          provider_id?: string
          received_at?: string
          update_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_updates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_flags: {
        Row: {
          created_at: string
          description: string
          flag_type: string
          id: string
          is_reviewed: boolean
          metadata: Json
          resolution: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          flag_type: string
          id?: string
          is_reviewed?: boolean
          metadata?: Json
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          flag_type?: string
          id?: string
          is_reviewed?: boolean
          metadata?: Json
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraud_flags_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fraud_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          key: string
          request_data: Json
          response_data: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          key: string
          request_data?: Json
          response_data?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          key?: string
          request_data?: Json
          response_data?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_documents: {
        Row: {
          admin_note: string | null
          document_type: string
          file_url: string
          id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level: string
          source_of_funds_status: string
          status: string
          uploaded_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          document_type: string
          file_url: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          source_of_funds_status?: string
          status?: string
          uploaded_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          document_type?: string
          file_url?: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          source_of_funds_status?: string
          status?: string
          uploaded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyc_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kyc_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          country: string | null
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          slug: string
          sport_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sport_id: string
        }
        Update: {
          country?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sport_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_accounts: {
        Row: {
          lifetime_points: number
          points: number
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          lifetime_points?: number
          points?: number
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          lifetime_points?: number
          points?: number
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_config: {
        Row: {
          auto_suspend_enabled: boolean
          created_at: string
          id: string
          margin_override: number | null
          market_id: string
          max_payout_override: number | null
          max_stake_override: number | null
          risk_factor: number
          updated_at: string
        }
        Insert: {
          auto_suspend_enabled?: boolean
          created_at?: string
          id?: string
          margin_override?: number | null
          market_id: string
          max_payout_override?: number | null
          max_stake_override?: number | null
          risk_factor?: number
          updated_at?: string
        }
        Update: {
          auto_suspend_enabled?: boolean
          created_at?: string
          id?: string
          margin_override?: number | null
          market_id?: string
          max_payout_override?: number | null
          max_stake_override?: number | null
          risk_factor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_config_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: true
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      market_correlation_rules: {
        Row: {
          adjustment_factor: number
          correlation_type: string
          created_at: string
          event_id: string | null
          id: string
          is_allowed: boolean
          market_id_1: string
          market_id_2: string
          rule_description: string | null
          updated_at: string
        }
        Insert: {
          adjustment_factor?: number
          correlation_type: string
          created_at?: string
          event_id?: string | null
          id?: string
          is_allowed?: boolean
          market_id_1: string
          market_id_2: string
          rule_description?: string | null
          updated_at?: string
        }
        Update: {
          adjustment_factor?: number
          correlation_type?: string
          created_at?: string
          event_id?: string | null
          id?: string
          is_allowed?: boolean
          market_id_1?: string
          market_id_2?: string
          rule_description?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_correlation_rules_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_correlation_rules_market_id_1_fkey"
            columns: ["market_id_1"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_correlation_rules_market_id_2_fkey"
            columns: ["market_id_2"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      market_correlations: {
        Row: {
          correlation_type: string
          created_at: string
          id: string
          is_active: boolean
          market_type_1: string
          market_type_2: string
          rule_description: string | null
        }
        Insert: {
          correlation_type: string
          created_at?: string
          id?: string
          is_active?: boolean
          market_type_1: string
          market_type_2: string
          rule_description?: string | null
        }
        Update: {
          correlation_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          market_type_1?: string
          market_type_2?: string
          rule_description?: string | null
        }
        Relationships: []
      }
      market_exposure: {
        Row: {
          bet_count: number
          created_at: string
          id: string
          last_bet_at: string | null
          market_id: string
          max_potential_payout: number
          risk_level: string
          selection_exposure: Json
          total_liability: number
          total_stake: number
          unique_users: number
          updated_at: string
        }
        Insert: {
          bet_count?: number
          created_at?: string
          id?: string
          last_bet_at?: string | null
          market_id: string
          max_potential_payout?: number
          risk_level?: string
          selection_exposure?: Json
          total_liability?: number
          total_stake?: number
          unique_users?: number
          updated_at?: string
        }
        Update: {
          bet_count?: number
          created_at?: string
          id?: string
          last_bet_at?: string | null
          market_id?: string
          max_potential_payout?: number
          risk_level?: string
          selection_exposure?: Json
          total_liability?: number
          total_stake?: number
          unique_users?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_exposure_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: true
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          created_at: string
          event_id: string
          id: string
          line: number | null
          name: string
          result: string | null
          settled_at: string | null
          status: string
          type: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          line?: number | null
          name: string
          result?: string | null
          settled_at?: string | null
          status?: string
          type: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          line?: number | null
          name?: string
          result?: string | null
          settled_at?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "markets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          account_updates: boolean
          bet_results: boolean
          live_events: boolean
          promotions: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_updates?: boolean
          bet_results?: boolean
          live_events?: boolean
          promotions?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_updates?: boolean
          bet_results?: boolean
          live_events?: boolean
          promotions?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          metadata: Json
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          metadata?: Json
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          metadata?: Json
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      odds: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_locked: boolean
          last_provider_update: string | null
          market_id: string
          selection: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_locked?: boolean
          last_provider_update?: string | null
          market_id: string
          selection: string
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_locked?: boolean
          last_provider_update?: string | null
          market_id?: string
          selection?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "odds_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      odds_history: {
        Row: {
          change_type: string
          changed_by: string | null
          created_at: string
          id: string
          margin_applied: number | null
          market_id: string
          new_value: number
          odds_id: string
          previous_value: number
          provider_odds: number | null
          selection: string
        }
        Insert: {
          change_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          margin_applied?: number | null
          market_id: string
          new_value: number
          odds_id: string
          previous_value: number
          provider_odds?: number | null
          selection: string
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          margin_applied?: number | null
          market_id?: string
          new_value?: number
          odds_id?: string
          previous_value?: number
          provider_odds?: number | null
          selection?: string
        }
        Relationships: [
          {
            foreignKeyName: "odds_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odds_history_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odds_history_odds_id_fkey"
            columns: ["odds_id"]
            isOneToOne: false
            referencedRelation: "odds"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          admin_role: string | null
          avatar_url: string | null
          country: string | null
          created_at: string | null
          date_of_birth: string | null
          demo_balance: number
          deposit_limit: number | null
          display_currency: string
          email: string | null
          full_name: string | null
          id: string
          is_admin: boolean
          is_self_excluded: boolean
          is_suspended: boolean
          is_verified: boolean
          kyc_status: string
          kyc_verified_at: string | null
          locale: string
          loss_limit: number | null
          odds_format: string
          phone: string | null
          phone_number: string | null
          referral_code: string | null
          referred_by: string | null
          self_exclusion_until: string | null
          suspension_reason: string | null
          timezone: string
          two_factor_enabled: boolean
          updated_at: string | null
          username: string | null
        }
        Insert: {
          admin_role?: string | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          demo_balance?: number
          deposit_limit?: number | null
          display_currency?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_admin?: boolean
          is_self_excluded?: boolean
          is_suspended?: boolean
          is_verified?: boolean
          kyc_status?: string
          kyc_verified_at?: string | null
          locale?: string
          loss_limit?: number | null
          odds_format?: string
          phone?: string | null
          phone_number?: string | null
          referral_code?: string | null
          referred_by?: string | null
          self_exclusion_until?: string | null
          suspension_reason?: string | null
          timezone?: string
          two_factor_enabled?: boolean
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          admin_role?: string | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          demo_balance?: number
          deposit_limit?: number | null
          display_currency?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_admin?: boolean
          is_self_excluded?: boolean
          is_suspended?: boolean
          is_verified?: boolean
          kyc_status?: string
          kyc_verified_at?: string | null
          locale?: string
          loss_limit?: number | null
          odds_format?: string
          phone?: string | null
          phone_number?: string | null
          referral_code?: string | null
          referred_by?: string | null
          self_exclusion_until?: string | null
          suspension_reason?: string | null
          timezone?: string
          two_factor_enabled?: boolean
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          bonus_amount: number | null
          bonus_percentage: number | null
          created_at: string
          description: string | null
          expires_after_days: number
          id: string
          is_active: boolean
          loyalty_points_reward: number
          max_bonus: number | null
          min_deposit: number | null
          min_legs: number
          min_odds: number
          per_user_claim_limit: number
          promo_code: string | null
          requires_qualifying_deposit: boolean
          terms_and_conditions: string | null
          title: string
          total_claim_limit: number | null
          type: string
          updated_at: string
          valid_from: string
          valid_until: string
          wagering_requirement: number
        }
        Insert: {
          bonus_amount?: number | null
          bonus_percentage?: number | null
          created_at?: string
          description?: string | null
          expires_after_days?: number
          id?: string
          is_active?: boolean
          loyalty_points_reward?: number
          max_bonus?: number | null
          min_deposit?: number | null
          min_legs?: number
          min_odds?: number
          per_user_claim_limit?: number
          promo_code?: string | null
          requires_qualifying_deposit?: boolean
          terms_and_conditions?: string | null
          title: string
          total_claim_limit?: number | null
          type: string
          updated_at?: string
          valid_from?: string
          valid_until?: string
          wagering_requirement?: number
        }
        Update: {
          bonus_amount?: number | null
          bonus_percentage?: number | null
          created_at?: string
          description?: string | null
          expires_after_days?: number
          id?: string
          is_active?: boolean
          loyalty_points_reward?: number
          max_bonus?: number | null
          min_deposit?: number | null
          min_legs?: number
          min_odds?: number
          per_user_claim_limit?: number
          promo_code?: string | null
          requires_qualifying_deposit?: boolean
          terms_and_conditions?: string | null
          title?: string
          total_claim_limit?: number | null
          type?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string
          wagering_requirement?: number
        }
        Relationships: []
      }
      provider_event_map: {
        Row: {
          created_at: string
          event_id: string
          provider_event_id: string
          provider_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          provider_event_id: string
          provider_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          provider_event_id?: string
          provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_event_map_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_health: {
        Row: {
          avg_latency_ms: number
          consecutive_failures: number
          error_message: string | null
          failed_requests: number
          id: string
          is_primary: boolean
          last_failed_fetch: string | null
          last_successful_fetch: string | null
          provider_name: string
          provider_type: string
          status: string
          success_rate: number
          total_requests: number
          updated_at: string
        }
        Insert: {
          avg_latency_ms?: number
          consecutive_failures?: number
          error_message?: string | null
          failed_requests?: number
          id?: string
          is_primary?: boolean
          last_failed_fetch?: string | null
          last_successful_fetch?: string | null
          provider_name: string
          provider_type: string
          status?: string
          success_rate?: number
          total_requests?: number
          updated_at?: string
        }
        Update: {
          avg_latency_ms?: number
          consecutive_failures?: number
          error_message?: string | null
          failed_requests?: number
          id?: string
          is_primary?: boolean
          last_failed_fetch?: string | null
          last_successful_fetch?: string | null
          provider_name?: string
          provider_type?: string
          status?: string
          success_rate?: number
          total_requests?: number
          updated_at?: string
        }
        Relationships: []
      }
      responsible_gaming_limits: {
        Row: {
          created_at: string
          current_usage: number
          id: string
          is_active: boolean
          limit_type: string
          limit_value: number
          period_end: string
          period_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_usage?: number
          id?: string
          is_active?: boolean
          limit_type: string
          limit_value: number
          period_end: string
          period_start: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_usage?: number
          id?: string
          is_active?: boolean
          limit_type?: string
          limit_value?: number
          period_end?: string
          period_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "responsible_gaming_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_profiles: {
        Row: {
          avg_stake: number
          created_at: string
          flagged_at: string | null
          flagged_reason: string | null
          id: string
          last_bet_at: string | null
          max_payout: number
          max_stake: number
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level: string
          risk_score: number
          total_bets: number
          total_wagered: number
          total_won: number
          unusual_bet_count: number
          updated_at: string
          user_id: string
          win_rate: number
        }
        Insert: {
          avg_stake?: number
          created_at?: string
          flagged_at?: string | null
          flagged_reason?: string | null
          id?: string
          last_bet_at?: string | null
          max_payout?: number
          max_stake?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          risk_score?: number
          total_bets?: number
          total_wagered?: number
          total_won?: number
          unusual_bet_count?: number
          updated_at?: string
          user_id: string
          win_rate?: number
        }
        Update: {
          avg_stake?: number
          created_at?: string
          flagged_at?: string | null
          flagged_reason?: string | null
          id?: string
          last_bet_at?: string | null
          max_payout?: number
          max_stake?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          risk_score?: number
          total_bets?: number
          total_wagered?: number
          total_won?: number
          unusual_bet_count?: number
          updated_at?: string
          user_id?: string
          win_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "risk_profiles_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      self_exclusions: {
        Row: {
          created_at: string
          end_date: string | null
          exclusion_type: string
          id: string
          is_active: boolean
          reason: string | null
          start_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          exclusion_type: string
          id?: string
          is_active?: boolean
          reason?: string | null
          start_date?: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          exclusion_type?: string
          id?: string
          is_active?: boolean
          reason?: string | null
          start_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "self_exclusions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          bet_id: string
          bet_selection_id: string | null
          created_at: string
          id: string
          is_manual: boolean
          original_stake: number
          settled_by: string | null
          settlement_amount: number
          settlement_reason: string | null
          settlement_type: string
          wallet_transaction_id: string | null
        }
        Insert: {
          bet_id: string
          bet_selection_id?: string | null
          created_at?: string
          id?: string
          is_manual?: boolean
          original_stake: number
          settled_by?: string | null
          settlement_amount: number
          settlement_reason?: string | null
          settlement_type: string
          wallet_transaction_id?: string | null
        }
        Update: {
          bet_id?: string
          bet_selection_id?: string | null
          created_at?: string
          id?: string
          is_manual?: boolean
          original_stake?: number
          settled_by?: string | null
          settlement_amount?: number
          settlement_reason?: string | null
          settlement_type?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_bet_selection_id_fkey"
            columns: ["bet_selection_id"]
            isOneToOne: false
            referencedRelation: "bet_selections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_settled_by_fkey"
            columns: ["settled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      sport_config: {
        Row: {
          created_at: string
          default_margin: number
          id: string
          live_bet_delay_seconds: number
          max_payout: number
          max_stake: number
          risk_threshold: number
          sport_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_margin?: number
          id?: string
          live_bet_delay_seconds?: number
          max_payout?: number
          max_stake?: number
          risk_threshold?: number
          sport_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_margin?: number
          id?: string
          live_bet_delay_seconds?: number
          max_payout?: number
          max_stake?: number
          risk_threshold?: number
          sport_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sport_config_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: true
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      sports: {
        Row: {
          created_at: string
          display_order: number
          icon: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
        }
        Relationships: []
      }
      sports_feed_providers: {
        Row: {
          created_at: string
          created_by: string | null
          encrypted_api_key: string | null
          id: string
          is_demo: boolean
          is_enabled: boolean
          last_error: string | null
          last_event_count: number
          last_success_at: string | null
          last_sync_at: string | null
          name: string
          priority: number
          provider_type: string
          settings: Json
          status: string
          sync_interval_seconds: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          encrypted_api_key?: string | null
          id?: string
          is_demo?: boolean
          is_enabled?: boolean
          last_error?: string | null
          last_event_count?: number
          last_success_at?: string | null
          last_sync_at?: string | null
          name: string
          priority?: number
          provider_type: string
          settings?: Json
          status?: string
          sync_interval_seconds?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          encrypted_api_key?: string | null
          id?: string
          is_demo?: boolean
          is_enabled?: boolean
          last_error?: string | null
          last_event_count?: number
          last_success_at?: string | null
          last_sync_at?: string | null
          name?: string
          priority?: number
          provider_type?: string
          settings?: Json
          status?: string
          sync_interval_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sports_feed_providers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_messages: {
        Row: {
          author_id: string
          author_role: string
          created_at: string
          id: string
          is_internal: boolean
          message: string
          ticket_id: string
        }
        Insert: {
          author_id: string
          author_role: string
          created_at?: string
          id?: string
          is_internal?: boolean
          message: string
          ticket_id: string
        }
        Update: {
          author_id?: string
          author_role?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          message?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          id: string
          message: string
          priority: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          id?: string
          message: string
          priority?: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          id?: string
          message?: string
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trader_actions: {
        Row: {
          action_type: string
          admin_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: string | null
          new_value: Json | null
          previous_value: Json | null
          reason: string | null
        }
        Insert: {
          action_type: string
          admin_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          previous_value?: Json | null
          reason?: string | null
        }
        Update: {
          action_type?: string
          admin_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          previous_value?: Json | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trader_actions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_announcement_dismissals: {
        Row: {
          announcement_id: string
          dismissed_at: string
          id: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          dismissed_at?: string
          id?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          dismissed_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_announcement_dismissals_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      user_bonuses: {
        Row: {
          amount: number
          awarded_at: string
          claim_source: string
          completed_at: string | null
          expires_at: string | null
          forfeited_at: string | null
          id: string
          last_wagered_at: string | null
          promotion_id: string | null
          remaining_amount: number
          status: string
          user_id: string
          wagering_completed: number
          wagering_requirement: number
        }
        Insert: {
          amount: number
          awarded_at?: string
          claim_source?: string
          completed_at?: string | null
          expires_at?: string | null
          forfeited_at?: string | null
          id?: string
          last_wagered_at?: string | null
          promotion_id?: string | null
          remaining_amount?: number
          status?: string
          user_id: string
          wagering_completed?: number
          wagering_requirement?: number
        }
        Update: {
          amount?: number
          awarded_at?: string
          claim_source?: string
          completed_at?: string | null
          expires_at?: string | null
          forfeited_at?: string | null
          id?: string
          last_wagered_at?: string | null
          promotion_id?: string | null
          remaining_amount?: number
          status?: string
          user_id?: string
          wagering_completed?: number
          wagering_requirement?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_bonuses_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_bonuses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_limits: {
        Row: {
          created_at: string
          created_by: string | null
          current_usage: number
          id: string
          limit_type: string
          limit_value: number
          reset_at: string | null
          sport_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_usage?: number
          id?: string
          limit_type: string
          limit_value: number
          reset_at?: string | null
          sport_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_usage?: number
          id?: string
          limit_type?: string
          limit_value?: number
          reset_at?: string | null
          sport_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_limits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_limits_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_accounts: {
        Row: {
          balance: number
          bonus_balance: number
          created_at: string
          currency: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          bonus_balance?: number
          created_at?: string
          currency?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          bonus_balance?: number
          created_at?: string
          currency?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          description: string | null
          id: string
          metadata: Json
          reference_id: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          reference_id?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          reference_id?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_cashout: {
        Args: {
          p_bet_id: string
          p_cashout_type?: string
          p_partial_amount?: number
        }
        Returns: Json
      }
      cancel_bet_atomic: { Args: { p_bet_id: string }; Returns: Json }
      claim_promotion: {
        Args: { p_promo_code?: string; p_promotion_id: string }
        Returns: Json
      }
      close_support_ticket: { Args: { p_ticket_id: string }; Returns: string }
      create_support_ticket: {
        Args: {
          p_category?: string
          p_message: string
          p_priority?: string
          p_subject: string
        }
        Returns: string
      }
      expire_user_bonuses: { Args: { p_batch_size?: number }; Returns: Json }
      get_my_wallet_balances: { Args: never; Returns: Json }
      get_wallet_reconciliation_report: {
        Args: never
        Returns: {
          difference: number
          ledger_available: number
          profile_balance: number
          user_id: string
        }[]
      }
      has_admin_role: { Args: { p_allowed_roles?: string[] }; Returns: boolean }
      ingest_sports_feed_event: {
        Args: { p_payload: Json; p_update_id: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      place_bet_atomic: {
        Args: {
          p_bet_type: string
          p_idempotency_key: string
          p_selections: Json
          p_stake: number
        }
        Returns: Json
      }
      place_system_bet_atomic: {
        Args: {
          p_combination_size: number
          p_idempotency_key: string
          p_selections: Json
          p_stake: number
        }
        Returns: Json
      }
      process_next_settlement_job: { Args: never; Returns: Json }
      record_event_result_and_queue: {
        Args: {
          p_away_score: number
          p_event_id: string
          p_home_score: number
          p_market_results: Json
          p_provider_reference: string
          p_status: string
        }
        Returns: string
      }
      reply_support_ticket: {
        Args: { p_message: string; p_ticket_id: string }
        Returns: string
      }
      set_my_responsible_limit: {
        Args: { p_limit_type: string; p_limit_value: number }
        Returns: string
      }
      settle_bet: {
        Args: { p_bet_id: string; p_payout?: number; p_result: string }
        Returns: undefined
      }
      start_my_self_exclusion: {
        Args: {
          p_duration_days?: number
          p_exclusion_type: string
          p_reason?: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
