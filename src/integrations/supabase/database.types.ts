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
      admin_approval_requests: {
        Row: {
          action_type: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          entity_id: string
          id: string
          payload: Json
          request_note: string | null
          requested_by: string
          status: string
        }
        Insert: {
          action_type: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          entity_id: string
          id?: string
          payload?: Json
          request_note?: string | null
          requested_by: string
          status?: string
        }
        Update: {
          action_type?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          entity_id?: string
          id?: string
          payload?: Json
          request_note?: string | null
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_approval_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_approval_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          created_at: string
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          admin_id: string
          changes: Json | null
          created_at: string | null
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
          created_at?: string | null
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
          created_at?: string | null
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
          created_at: string | null
          dedupe_key: string | null
          error_message: string | null
          id: string
          job_type: string
          max_retries: number | null
          payload: Json
          priority: number | null
          result: Json | null
          retry_count: number | null
          scheduled_at: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          error_message?: string | null
          id?: string
          job_type: string
          max_retries?: number | null
          payload: Json
          priority?: number | null
          result?: Json | null
          retry_count?: number | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          error_message?: string | null
          id?: string
          job_type?: string
          max_retries?: number | null
          payload?: Json
          priority?: number | null
          result?: Json | null
          retry_count?: number | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      bet_idempotency: {
        Row: {
          bet_id: string | null
          created_at: string | null
          expires_at: string
          id: string
          idempotency_key: string
          request_hash: string
          user_id: string
        }
        Insert: {
          bet_id?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          idempotency_key: string
          request_hash: string
          user_id: string
        }
        Update: {
          bet_id?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          request_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_idempotency_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_selections: {
        Row: {
          bet_id: string
          created_at: string | null
          event_id: string
          id: string
          market_id: string
          odds_id: string
          odds_value: number
          result: string | null
          selection: string
        }
        Insert: {
          bet_id: string
          created_at?: string | null
          event_id: string
          id?: string
          market_id: string
          odds_id: string
          odds_value: number
          result?: string | null
          selection: string
        }
        Update: {
          bet_id?: string
          created_at?: string | null
          event_id?: string
          id?: string
          market_id?: string
          odds_id?: string
          odds_value?: number
          result?: string | null
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
          created_at: string | null
          id: string
          payout: number | null
          potential_return: number
          settled_at: string | null
          stake: number
          status: string | null
          total_odds: number
          type: string
          user_id: string
          wallet_transaction_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          payout?: number | null
          potential_return: number
          settled_at?: string | null
          stake: number
          status?: string | null
          total_odds: number
          type: string
          user_id: string
          wallet_transaction_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          payout?: number | null
          potential_return?: number
          settled_at?: string | null
          stake?: number
          status?: string | null
          total_odds?: number
          type?: string
          user_id?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bets_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_commissions: {
        Row: {
          approved_at: string | null
          bet_id: string
          broker_id: string
          commission_amount: number
          commission_bps: number
          created_at: string
          gross_revenue: number
          id: string
          paid_at: string | null
          player_id: string
          status: string
        }
        Insert: {
          approved_at?: string | null
          bet_id: string
          broker_id: string
          commission_amount: number
          commission_bps: number
          created_at?: string
          gross_revenue: number
          id?: string
          paid_at?: string | null
          player_id: string
          status?: string
        }
        Update: {
          approved_at?: string | null
          bet_id?: string
          broker_id?: string
          commission_amount?: number
          commission_bps?: number
          created_at?: string
          gross_revenue?: number
          id?: string
          paid_at?: string | null
          player_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_commissions_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: true
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_commissions_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_commissions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_payout_requests: {
        Row: {
          amount: number
          broker_id: string
          destination_reference: string | null
          id: string
          notes: string | null
          paid_at: string | null
          payment_reference: string | null
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          amount: number
          broker_id: string
          destination_reference?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_reference?: string | null
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          broker_id?: string
          destination_reference?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_reference?: string | null
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_payout_requests_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_payout_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_players: {
        Row: {
          attributed_at: string
          attribution_source: string
          broker_id: string
          id: string
          is_active: boolean
          player_id: string
        }
        Insert: {
          attributed_at?: string
          attribution_source?: string
          broker_id: string
          id?: string
          is_active?: boolean
          player_id: string
        }
        Update: {
          attributed_at?: string
          attribution_source?: string
          broker_id?: string
          id?: string
          is_active?: boolean
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_players_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brokers: {
        Row: {
          broker_code: string
          commission_bps: number
          company_name: string
          created_at: string
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          settlement_model: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          broker_code: string
          commission_bps?: number
          company_name: string
          created_at?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_model?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          broker_code?: string
          commission_bps?: number
          company_name?: string
          created_at?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_model?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brokers_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brokers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
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
          expires_at: string
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
      crypto_deposit_invoices: {
        Row: {
          actually_paid: number
          completed_at: string | null
          created_at: string
          expires_at: string | null
          fiat_amount: number
          fiat_currency: string
          id: string
          idempotency_key: string
          pay_address: string | null
          pay_amount: number | null
          pay_currency: string
          provider: string
          provider_payload: Json
          provider_payment_id: string | null
          refunded_at: string | null
          reversal_transaction_id: string | null
          status: string
          tx_hash: string | null
          updated_at: string
          user_id: string
          wallet_transaction_id: string | null
        }
        Insert: {
          actually_paid?: number
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          fiat_amount: number
          fiat_currency?: string
          id?: string
          idempotency_key: string
          pay_address?: string | null
          pay_amount?: number | null
          pay_currency: string
          provider?: string
          provider_payload?: Json
          provider_payment_id?: string | null
          refunded_at?: string | null
          reversal_transaction_id?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
          user_id: string
          wallet_transaction_id?: string | null
        }
        Update: {
          actually_paid?: number
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          fiat_amount?: number
          fiat_currency?: string
          id?: string
          idempotency_key?: string
          pay_address?: string | null
          pay_amount?: number | null
          pay_currency?: string
          provider?: string
          provider_payload?: Json
          provider_payment_id?: string | null
          refunded_at?: string | null
          reversal_transaction_id?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
          user_id?: string
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crypto_deposit_invoices_reversal_transaction_id_fkey"
            columns: ["reversal_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crypto_deposit_invoices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crypto_deposit_invoices_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      crypto_webhook_events: {
        Row: {
          event_key: string
          id: string
          payload: Json
          payload_hash: string
          payment_status: string
          processed_at: string
          provider: string
          provider_payment_id: string
          signature_verified: boolean
        }
        Insert: {
          event_key: string
          id?: string
          payload: Json
          payload_hash: string
          payment_status: string
          processed_at?: string
          provider: string
          provider_payment_id: string
          signature_verified?: boolean
        }
        Update: {
          event_key?: string
          id?: string
          payload?: Json
          payload_hash?: string
          payment_status?: string
          processed_at?: string
          provider?: string
          provider_payment_id?: string
          signature_verified?: boolean
        }
        Relationships: []
      }
      early_payout_awards: {
        Row: {
          bet_selection_id: string
          created_at: string
          event_id: string
          id: string
          match_minute: number
          rule_id: string
          score: string
        }
        Insert: {
          bet_selection_id: string
          created_at?: string
          event_id: string
          id?: string
          match_minute: number
          rule_id: string
          score: string
        }
        Update: {
          bet_selection_id?: string
          created_at?: string
          event_id?: string
          id?: string
          match_minute?: number
          rule_id?: string
          score?: string
        }
        Relationships: [
          {
            foreignKeyName: "early_payout_awards_bet_selection_id_fkey"
            columns: ["bet_selection_id"]
            isOneToOne: true
            referencedRelation: "bet_selections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "early_payout_awards_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "early_payout_awards_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "early_payout_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      early_payout_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_enabled: boolean
          market_type: string
          minimum_lead: number
          minimum_minute: number
          name: string
          sport_slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          market_type?: string
          minimum_lead: number
          minimum_minute: number
          name: string
          sport_slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_enabled?: boolean
          market_type?: string
          minimum_lead?: number
          minimum_minute?: number
          name?: string
          sport_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "early_payout_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      event_timeline: {
        Row: {
          created_at: string
          description: string | null
          event_id: string
          feed_update_id: string | null
          id: string
          incident_type: string
          match_minute: number | null
          provider_id: string | null
          provider_incident_id: string | null
          score_away: number | null
          score_home: number | null
          team_side: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_id: string
          feed_update_id?: string | null
          id?: string
          incident_type: string
          match_minute?: number | null
          provider_id?: string | null
          provider_incident_id?: string | null
          score_away?: number | null
          score_home?: number | null
          team_side?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          event_id?: string
          feed_update_id?: string | null
          id?: string
          incident_type?: string
          match_minute?: number | null
          provider_id?: string | null
          provider_incident_id?: string | null
          score_away?: number | null
          score_home?: number | null
          team_side?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_timeline_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_timeline_feed_update_id_fkey"
            columns: ["feed_update_id"]
            isOneToOne: false
            referencedRelation: "feed_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          away_team: string
          created_at: string | null
          home_team: string
          id: string
          is_featured: boolean | null
          is_suspended: boolean
          league_id: string | null
          live_minute: number | null
          live_score_away: number | null
          live_score_home: number | null
          metadata: Json | null
          provider_event_id: string | null
          provider_id: string | null
          sport_id: string
          start_time: string
          status: string | null
          updated_at: string | null
          venue: string | null
        }
        Insert: {
          away_team: string
          created_at?: string | null
          home_team: string
          id?: string
          is_featured?: boolean | null
          is_suspended?: boolean
          league_id?: string | null
          live_minute?: number | null
          live_score_away?: number | null
          live_score_home?: number | null
          metadata?: Json | null
          provider_event_id?: string | null
          provider_id?: string | null
          sport_id: string
          start_time: string
          status?: string | null
          updated_at?: string | null
          venue?: string | null
        }
        Update: {
          away_team?: string
          created_at?: string | null
          home_team?: string
          id?: string
          is_featured?: boolean | null
          is_suspended?: boolean
          league_id?: string | null
          live_minute?: number | null
          live_score_away?: number | null
          live_score_home?: number | null
          metadata?: Json | null
          provider_event_id?: string | null
          provider_id?: string | null
          sport_id?: string
          start_time?: string
          status?: string | null
          updated_at?: string | null
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
          created_at: string | null
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
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
          created_at: string | null
          description: string
          flag_type: string
          id: string
          is_reviewed: boolean | null
          metadata: Json | null
          resolution: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description: string
          flag_type: string
          id?: string
          is_reviewed?: boolean | null
          metadata?: Json | null
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string
          flag_type?: string
          id?: string
          is_reviewed?: boolean | null
          metadata?: Json | null
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          user_id?: string
        }
        Relationships: []
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
          request_data: Json
          response_data: Json
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
        Relationships: []
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
          status: string | null
          uploaded_at: string | null
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
          status?: string | null
          uploaded_at?: string | null
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
          status?: string | null
          uploaded_at?: string | null
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
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          name: string
          slug: string
          sport_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          slug: string
          sport_id: string
        }
        Update: {
          country?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
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
      ledger_accounts: {
        Row: {
          account_code: string
          balance: number
          created_at: string
          currency: string
          id: string
          is_system: boolean
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_code: string
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          is_system?: boolean
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_code?: string
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          is_system?: boolean
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_journals: {
        Row: {
          created_at: string
          description: string | null
          id: string
          idempotency_key: string
          metadata: Json
          source_transaction_id: string | null
          source_type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          source_transaction_id?: string | null
          source_type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          source_transaction_id?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_journals_source_transaction_id_fkey"
            columns: ["source_transaction_id"]
            isOneToOne: true
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_postings: {
        Row: {
          account_id: string
          amount: number
          balance_after: number
          created_at: string
          id: string
          journal_id: string
        }
        Insert: {
          account_id: string
          amount: number
          balance_after: number
          created_at?: string
          id?: string
          journal_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          balance_after?: number
          created_at?: string
          id?: string
          journal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_postings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_postings_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "ledger_journals"
            referencedColumns: ["id"]
          },
        ]
      }
      live_bet_config: {
        Row: {
          acceptance_delay_seconds: number
          auto_suspend_events: string[] | null
          created_at: string | null
          id: string
          is_active: boolean | null
          sport: string
          updated_at: string | null
        }
        Insert: {
          acceptance_delay_seconds?: number
          auto_suspend_events?: string[] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          sport: string
          updated_at?: string | null
        }
        Update: {
          acceptance_delay_seconds?: number
          auto_suspend_events?: string[] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          sport?: string
          updated_at?: string | null
        }
        Relationships: []
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
      manual_deposit_requests: {
        Row: {
          amount: number
          created_at: string
          id: string
          payment_method_id: string
          proof_file_path: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_score: number
          status: string
          transaction_reference: string
          updated_at: string
          user_id: string
          user_note: string | null
          wallet_transaction_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          payment_method_id: string
          proof_file_path?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_score?: number
          status?: string
          transaction_reference: string
          updated_at?: string
          user_id: string
          user_note?: string | null
          wallet_transaction_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payment_method_id?: string
          proof_file_path?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_score?: number
          status?: string
          transaction_reference?: string
          updated_at?: string
          user_id?: string
          user_note?: string | null
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_deposit_requests_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_deposit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_deposit_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_deposit_requests_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_withdrawal_requests: {
        Row: {
          amount: number
          created_at: string
          destination_reference: string
          id: string
          payment_method_id: string
          payment_reference: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_score: number
          status: string
          updated_at: string
          user_id: string
          user_note: string | null
          wallet_transaction_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          destination_reference: string
          id?: string
          payment_method_id: string
          payment_reference?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_score?: number
          status?: string
          updated_at?: string
          user_id: string
          user_note?: string | null
          wallet_transaction_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          destination_reference?: string
          id?: string
          payment_method_id?: string
          payment_reference?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_score?: number
          status?: string
          updated_at?: string
          user_id?: string
          user_note?: string | null
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_withdrawal_requests_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_withdrawal_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_withdrawal_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_withdrawal_requests_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
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
          adjustment_factor: number | null
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
          adjustment_factor?: number | null
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
          adjustment_factor?: number | null
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
        ]
      }
      market_correlations: {
        Row: {
          correlation_type: string
          created_at: string | null
          id: string
          is_active: boolean | null
          market_type_1: string
          market_type_2: string
          rule_description: string | null
        }
        Insert: {
          correlation_type: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          market_type_1: string
          market_type_2: string
          rule_description?: string | null
        }
        Update: {
          correlation_type?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
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
          created_at: string | null
          event_id: string
          id: string
          line: number | null
          name: string
          result: string | null
          settled_at: string | null
          status: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          line?: number | null
          name: string
          result?: string | null
          settled_at?: string | null
          status?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          id?: string
          line?: number | null
          name?: string
          result?: string | null
          settled_at?: string | null
          status?: string | null
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
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      odds: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          is_locked: boolean
          last_provider_update: string | null
          market_id: string
          provider_id: string | null
          provider_odds: number | null
          selection: string
          updated_at: string | null
          value: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_locked?: boolean
          last_provider_update?: string | null
          market_id: string
          provider_id?: string | null
          provider_odds?: number | null
          selection: string
          updated_at?: string | null
          value: number
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_locked?: boolean
          last_provider_update?: string | null
          market_id?: string
          provider_id?: string | null
          provider_odds?: number | null
          selection?: string
          updated_at?: string | null
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
          change_type: string
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
      payment_methods: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          created_by: string | null
          currency: string
          destination_reference: string | null
          display_order: number
          id: string
          instructions: string | null
          is_enabled: boolean
          max_amount: number
          method_type: string
          min_amount: number
          name: string
          network: string | null
          provider_code: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          currency: string
          destination_reference?: string | null
          display_order?: number
          id?: string
          instructions?: string | null
          is_enabled?: boolean
          max_amount?: number
          method_type: string
          min_amount?: number
          name: string
          network?: string | null
          provider_code?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          destination_reference?: string | null
          display_order?: number
          id?: string
          instructions?: string | null
          is_enabled?: boolean
          max_amount?: number
          method_type?: string
          min_amount?: number
          name?: string
          network?: string | null
          provider_code?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          demo_balance: number | null
          deposit_limit: number | null
          display_currency: string
          email: string | null
          full_name: string | null
          id: string
          is_admin: boolean
          is_suspended: boolean
          is_verified: boolean | null
          kyc_status: string | null
          locale: string
          loss_limit: number | null
          odds_format: string
          phone_number: string | null
          referral_code: string | null
          referred_by: string | null
          self_exclusion_until: string | null
          suspension_reason: string | null
          timezone: string
          two_factor_enabled: boolean | null
          updated_at: string | null
        }
        Insert: {
          admin_role?: string | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          demo_balance?: number | null
          deposit_limit?: number | null
          display_currency?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_admin?: boolean
          is_suspended?: boolean
          is_verified?: boolean | null
          kyc_status?: string | null
          locale?: string
          loss_limit?: number | null
          odds_format?: string
          phone_number?: string | null
          referral_code?: string | null
          referred_by?: string | null
          self_exclusion_until?: string | null
          suspension_reason?: string | null
          timezone?: string
          two_factor_enabled?: boolean | null
          updated_at?: string | null
        }
        Update: {
          admin_role?: string | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          demo_balance?: number | null
          deposit_limit?: number | null
          display_currency?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_admin?: boolean
          is_suspended?: boolean
          is_verified?: boolean | null
          kyc_status?: string | null
          locale?: string
          loss_limit?: number | null
          odds_format?: string
          phone_number?: string | null
          referral_code?: string | null
          referred_by?: string | null
          self_exclusion_until?: string | null
          suspension_reason?: string | null
          timezone?: string
          two_factor_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      promotions: {
        Row: {
          bonus_amount: number | null
          bonus_percentage: number | null
          created_at: string | null
          description: string | null
          expires_after_days: number
          id: string
          is_active: boolean | null
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
          wagering_requirement: number | null
        }
        Insert: {
          bonus_amount?: number | null
          bonus_percentage?: number | null
          created_at?: string | null
          description?: string | null
          expires_after_days?: number
          id?: string
          is_active?: boolean | null
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
          valid_from: string
          valid_until: string
          wagering_requirement?: number | null
        }
        Update: {
          bonus_amount?: number | null
          bonus_percentage?: number | null
          created_at?: string | null
          description?: string | null
          expires_after_days?: number
          id?: string
          is_active?: boolean | null
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
          wagering_requirement?: number | null
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
          avg_latency_ms: number | null
          consecutive_failures: number | null
          error_message: string | null
          failed_requests: number | null
          id: string
          is_primary: boolean | null
          last_failed_fetch: string | null
          last_successful_fetch: string | null
          provider_name: string
          provider_type: string
          status: string
          success_rate: number | null
          total_requests: number | null
          updated_at: string | null
        }
        Insert: {
          avg_latency_ms?: number | null
          consecutive_failures?: number | null
          error_message?: string | null
          failed_requests?: number | null
          id?: string
          is_primary?: boolean | null
          last_failed_fetch?: string | null
          last_successful_fetch?: string | null
          provider_name: string
          provider_type: string
          status?: string
          success_rate?: number | null
          total_requests?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_latency_ms?: number | null
          consecutive_failures?: number | null
          error_message?: string | null
          failed_requests?: number | null
          id?: string
          is_primary?: boolean | null
          last_failed_fetch?: string | null
          last_successful_fetch?: string | null
          provider_name?: string
          provider_type?: string
          status?: string
          success_rate?: number | null
          total_requests?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      responsible_gaming_limits: {
        Row: {
          created_at: string | null
          current_usage: number | null
          id: string
          is_active: boolean | null
          limit_type: string
          limit_value: number
          period_end: string
          period_start: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_usage?: number | null
          id?: string
          is_active?: boolean | null
          limit_type: string
          limit_value: number
          period_end: string
          period_start: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_usage?: number | null
          id?: string
          is_active?: boolean | null
          limit_type?: string
          limit_value?: number
          period_end?: string
          period_start?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      risk_engine_config: {
        Row: {
          auto_suspend_percentage: number
          id: boolean
          max_event_liability: number
          max_market_liability: number
          max_single_payout: number
          max_single_stake: number
          unusual_stake_multiplier: number
          updated_at: string
          updated_by: string | null
          velocity_bets_per_minute: number
        }
        Insert: {
          auto_suspend_percentage?: number
          id?: boolean
          max_event_liability?: number
          max_market_liability?: number
          max_single_payout?: number
          max_single_stake?: number
          unusual_stake_multiplier?: number
          updated_at?: string
          updated_by?: string | null
          velocity_bets_per_minute?: number
        }
        Update: {
          auto_suspend_percentage?: number
          id?: boolean
          max_event_liability?: number
          max_market_liability?: number
          max_single_payout?: number
          max_single_stake?: number
          unusual_stake_multiplier?: number
          updated_at?: string
          updated_by?: string | null
          velocity_bets_per_minute?: number
        }
        Relationships: [
          {
            foreignKeyName: "risk_engine_config_updated_by_fkey"
            columns: ["updated_by"]
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
          created_at: string | null
          end_date: string | null
          exclusion_type: string
          id: string
          is_active: boolean | null
          reason: string | null
          start_date: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          exclusion_type: string
          id?: string
          is_active?: boolean | null
          reason?: string | null
          start_date?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          exclusion_type?: string
          id?: string
          is_active?: boolean | null
          reason?: string | null
          start_date?: string
          user_id?: string
        }
        Relationships: []
      }
      settlement_versions: {
        Row: {
          bet_id: string
          created_at: string | null
          id: string
          previous_settlement_id: string | null
          reason: string | null
          settled_by: string
          settlement_amount: number
          settlement_type: string
          version: number
        }
        Insert: {
          bet_id: string
          created_at?: string | null
          id?: string
          previous_settlement_id?: string | null
          reason?: string | null
          settled_by: string
          settlement_amount: number
          settlement_type: string
          version?: number
        }
        Update: {
          bet_id?: string
          created_at?: string | null
          id?: string
          previous_settlement_id?: string | null
          reason?: string | null
          settled_by?: string
          settlement_amount?: number
          settlement_type?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "settlement_versions_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_versions_previous_settlement_id_fkey"
            columns: ["previous_settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
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
          auto_suspend_on_goal: boolean
          auto_suspend_on_penalty: boolean
          auto_suspend_on_red_card: boolean
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
          auto_suspend_on_goal?: boolean
          auto_suspend_on_penalty?: boolean
          auto_suspend_on_red_card?: boolean
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
          auto_suspend_on_goal?: boolean
          auto_suspend_on_penalty?: boolean
          auto_suspend_on_red_card?: boolean
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
          created_at: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
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
      support_tickets: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          id: string
          message: string
          priority: string | null
          status: string | null
          subject: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          id?: string
          message: string
          priority?: string | null
          status?: string | null
          subject: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          id?: string
          message?: string
          priority?: string | null
          status?: string | null
          subject?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_bet_line_selections: {
        Row: {
          bet_selection_id: string
          line_id: string
        }
        Insert: {
          bet_selection_id: string
          line_id: string
        }
        Update: {
          bet_selection_id?: string
          line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_bet_line_selections_bet_selection_id_fkey"
            columns: ["bet_selection_id"]
            isOneToOne: false
            referencedRelation: "bet_selections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_bet_line_selections_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "system_bet_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      system_bet_lines: {
        Row: {
          bet_id: string
          combination_size: number
          created_at: string
          id: string
          line_odds: number
          line_stake: number
          payout: number | null
          potential_return: number
          result: string
        }
        Insert: {
          bet_id: string
          combination_size: number
          created_at?: string
          id?: string
          line_odds: number
          line_stake: number
          payout?: number | null
          potential_return: number
          result?: string
        }
        Update: {
          bet_id?: string
          combination_size?: number
          created_at?: string
          id?: string
          line_odds?: number
          line_stake?: number
          payout?: number | null
          potential_return?: number
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_bet_lines_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
        ]
      }
      trader_actions: {
        Row: {
          action_type: string
          admin_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: unknown
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
          ip_address?: unknown
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
          ip_address?: unknown
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
          {
            foreignKeyName: "user_announcement_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_bonuses: {
        Row: {
          amount: number
          awarded_at: string | null
          claim_source: string
          completed_at: string | null
          expires_at: string | null
          forfeited_at: string | null
          id: string
          last_wagered_at: string | null
          promotion_id: string | null
          remaining_amount: number
          status: string | null
          user_id: string
          wagering_completed: number | null
          wagering_requirement: number
        }
        Insert: {
          amount: number
          awarded_at?: string | null
          claim_source?: string
          completed_at?: string | null
          expires_at?: string | null
          forfeited_at?: string | null
          id?: string
          last_wagered_at?: string | null
          promotion_id?: string | null
          remaining_amount?: number
          status?: string | null
          user_id: string
          wagering_completed?: number | null
          wagering_requirement: number
        }
        Update: {
          amount?: number
          awarded_at?: string | null
          claim_source?: string
          completed_at?: string | null
          expires_at?: string | null
          forfeited_at?: string | null
          id?: string
          last_wagered_at?: string | null
          promotion_id?: string | null
          remaining_amount?: number
          status?: string | null
          user_id?: string
          wagering_completed?: number | null
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
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number | null
          created_at: string | null
          description: string | null
          id: string
          metadata: Json | null
          reference_id: string | null
          status: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          reference_id?: string | null
          status?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          reference_id?: string | null
          status?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_user_id_fkey"
            columns: ["user_id"]
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
      accept_cashout: {
        Args: {
          p_bet_id: string
          p_cashout_type?: string
          p_partial_amount?: number
        }
        Returns: Json
      }
      apply_crypto_deposit_update: {
        Args: {
          p_actually_paid: number
          p_event_key: string
          p_invoice_id: string
          p_pay_amount: number
          p_pay_currency: string
          p_payload: Json
          p_payload_hash: string
          p_payment_status: string
          p_price_amount: number
          p_price_currency: string
          p_provider: string
          p_provider_payment_id: string
          p_tx_hash: string
        }
        Returns: Json
      }
      apply_for_broker: { Args: { p_company_name: string }; Returns: Json }
      archive_payment_method: { Args: { p_id: string }; Returns: undefined }
      award_bonus: {
        Args: {
          p_amount: number
          p_promotion_id: string
          p_user_id: string
          p_wagering_requirement: number
        }
        Returns: string
      }
      cancel_bet_atomic: { Args: { p_bet_id: string }; Returns: Json }
      claim_promotion: {
        Args: { p_promo_code?: string; p_promotion_id: string }
        Returns: Json
      }
      decide_admin_approval: {
        Args: { p_approval_id: string; p_decision: string; p_note?: string }
        Returns: undefined
      }
      delete_early_payout_rule: { Args: { p_id: string }; Returns: undefined }
      ensure_user_ledger_accounts_from_id: {
        Args: { p_cash_balance?: number; p_user_id: string }
        Returns: undefined
      }
      expire_user_bonuses: { Args: { p_batch_size?: number }; Returns: Json }
      finalize_manual_deposit_approval: {
        Args: { p_admin: string; p_note: string; p_request_id: string }
        Returns: undefined
      }
      finalize_manual_withdrawal_approval: {
        Args: {
          p_admin: string
          p_note: string
          p_payment_reference?: string
          p_request_id: string
        }
        Returns: undefined
      }
      get_my_broker_dashboard: { Args: never; Returns: Json }
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
      is_aal2: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_service_role: { Args: never; Returns: boolean }
      link_my_broker: { Args: { p_broker_code: string }; Returns: Json }
      place_bet: {
        Args: {
          p_bet_type: string
          p_selections: Json
          p_stake: number
          p_user_id: string
        }
        Returns: string
      }
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
      process_early_payout_for_event: {
        Args: { p_event_id: string }
        Returns: number
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
      reject_manual_withdrawal: {
        Args: { p_admin: string; p_note: string; p_request_id: string }
        Returns: undefined
      }
      request_broker_payout: {
        Args: { p_amount: number; p_destination_reference: string }
        Returns: string
      }
      review_broker_application: {
        Args: {
          p_broker_id: string
          p_commission_bps: number
          p_notes?: string
          p_status: string
        }
        Returns: undefined
      }
      review_broker_payout: {
        Args: {
          p_notes?: string
          p_payment_reference?: string
          p_request_id: string
          p_status: string
        }
        Returns: undefined
      }
      review_kyc_document_manual: {
        Args: {
          p_action: string
          p_document_id: string
          p_note: string
          p_risk_level?: string
          p_source_of_funds_status?: string
        }
        Returns: undefined
      }
      review_manual_deposit_request: {
        Args: { p_request_id: string; p_review_note?: string; p_status: string }
        Returns: undefined
      }
      review_manual_withdrawal_request: {
        Args: { p_request_id: string; p_review_note?: string; p_status: string }
        Returns: undefined
      }
      save_early_payout_rule: {
        Args: {
          p_id: string
          p_is_enabled: boolean
          p_market_type: string
          p_minimum_lead: number
          p_minimum_minute: number
          p_name: string
          p_sport_slug: string
        }
        Returns: string
      }
      save_payment_method: {
        Args: {
          p_code: string
          p_currency: string
          p_destination_reference: string
          p_display_order: number
          p_id: string
          p_instructions: string
          p_is_enabled: boolean
          p_max_amount: number
          p_method_type: string
          p_min_amount: number
          p_name: string
          p_network: string
          p_provider_code: string
        }
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
      submit_manual_deposit_request: {
        Args: {
          p_amount: number
          p_payment_method_id: string
          p_proof_file_path?: string
          p_transaction_reference: string
          p_user_note?: string
        }
        Returns: string
      }
      submit_manual_withdrawal_request: {
        Args: {
          p_amount: number
          p_destination_reference: string
          p_payment_method_id: string
          p_user_note?: string
        }
        Returns: string
      }
      transfer_user_bonus_funds: {
        Args: {
          p_bonus_id: string
          p_destination: string
          p_requested_amount: number
          p_user_id: string
        }
        Returns: number
      }
      update_my_display_preferences: {
        Args: {
          p_currency: string
          p_locale: string
          p_odds_format: string
          p_timezone: string
        }
        Returns: undefined
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
