import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: any;
  created_at?: string;
}

export interface AuthError {
  message: string;
  code?: string;
}

const DEFAULT_SITE_URL = "http://localhost:3000";

function getURL(): string {
  let url = process?.env?.NEXT_PUBLIC_VERCEL_URL ?? process?.env?.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL;

  if (!url) {
    url = DEFAULT_SITE_URL;
  }

  url = url.startsWith("http") ? url : `https://${url}`;
  return url.endsWith("/") ? url : `${url}/`;
}

function mapAuthUser(user: User | null): AuthUser | null {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? "",
    user_metadata: user.user_metadata,
    created_at: user.created_at,
  };
}

export async function ensureUserProfile(user: User): Promise<AuthError | null> {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      full_name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
    },
    { onConflict: "id" }
  );

  if (error) {
    return {
      message: error.message,
      code: error.code,
    };
  }

  return null;
}

export const authService = {
  async getCurrentUser(): Promise<AuthUser | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return mapAuthUser(user);
  },

  async getCurrentSession(): Promise<Session | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session;
  },

  async signUp(email: string, password: string): Promise<{ user: AuthUser | null; error: AuthError | null }> {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${getURL()}auth/login?confirmed=1`,
        },
      });

      if (error) {
        return {
          user: null,
          error: {
            message: error.message,
            code: error.status?.toString(),
          },
        };
      }

      if (data.user && data.session) {
        const profileError = await ensureUserProfile(data.user);
        if (profileError) {
          return {
            user: mapAuthUser(data.user),
            error: profileError,
          };
        }
      }

      return {
        user: mapAuthUser(data.user),
        error: null,
      };
    } catch {
      return {
        user: null,
        error: {
          message: "An unexpected error occurred during sign up",
        },
      };
    }
  },

  async signIn(email: string, password: string): Promise<{ user: AuthUser | null; error: AuthError | null }> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return {
          user: null,
          error: {
            message: error.message,
            code: error.status?.toString(),
          },
        };
      }

      if (data.user) {
        const profileError = await ensureUserProfile(data.user);
        if (profileError) {
          return {
            user: mapAuthUser(data.user),
            error: profileError,
          };
        }
      }

      return {
        user: mapAuthUser(data.user),
        error: null,
      };
    } catch {
      return {
        user: null,
        error: {
          message: "An unexpected error occurred during sign in",
        },
      };
    }
  },

  async signOut(): Promise<{ error: AuthError | null }> {
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        return {
          error: {
            message: error.message,
          },
        };
      }

      return { error: null };
    } catch {
      return {
        error: {
          message: "An unexpected error occurred during sign out",
        },
      };
    }
  },

  async resetPassword(email: string): Promise<{ error: AuthError | null }> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getURL()}auth/reset-password`,
      });

      if (error) {
        return {
          error: {
            message: error.message,
          },
        };
      }

      return { error: null };
    } catch {
      return {
        error: {
          message: "An unexpected error occurred during password reset",
        },
      };
    }
  },

  async confirmEmail(
    token: string,
    type: "signup" | "recovery" | "email_change" = "signup"
  ): Promise<{ user: AuthUser | null; error: AuthError | null }> {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type,
      });

      if (error) {
        return {
          user: null,
          error: {
            message: error.message,
            code: error.status?.toString(),
          },
        };
      }

      if (data.user) {
        const profileError = await ensureUserProfile(data.user);
        if (profileError) {
          return {
            user: mapAuthUser(data.user),
            error: profileError,
          };
        }
      }

      return {
        user: mapAuthUser(data.user),
        error: null,
      };
    } catch {
      return {
        user: null,
        error: {
          message: "An unexpected error occurred during email confirmation",
        },
      };
    }
  },

  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};