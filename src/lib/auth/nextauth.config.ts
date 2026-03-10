import CredentialsProvider from 'next-auth/providers/credentials';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NextAuthOptions } from 'next-auth';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const supabase = createAdminClient();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email,
          password: credentials.password,
        });
        if (error || !data.user) return null;

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        let enterpriseName: string | null = null;
        if (profile?.enterprise_id) {
          const { data: ent } = await supabase
            .from('enterprises')
            .select('name')
            .eq('id', profile.enterprise_id)
            .single();
          enterpriseName = ent?.name ?? null;
        }

        return {
          id: data.user.id,
          email: data.user.email!,
          name: profile?.full_name ?? data.user.email,
          role: profile?.role ?? 'auditor',
          onboarding_done: profile?.onboarding_done ?? false,
          enterprise_id: profile?.enterprise_id ?? null,
          enterprise_name: enterpriseName,
          is_app_admin: profile?.is_app_admin ?? false,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? 'auditor';
        token.onboarding_done =
          (user as { onboarding_done?: boolean }).onboarding_done ?? false;
        token.enterprise_id =
          (user as { enterprise_id?: string | null }).enterprise_id ?? null;
        token.enterprise_name =
          (user as { enterprise_name?: string | null }).enterprise_name ?? null;
        token.is_app_admin =
          (user as { is_app_admin?: boolean }).is_app_admin ?? false;
      }
      // Re-fetch from DB whenever the session is explicitly updated
      // (e.g. after completing onboarding)
      if (trigger === 'update' && token.id) {
        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role, onboarding_done, enterprise_id, is_app_admin')
          .eq('id', token.id)
          .single();
        if (profile) {
          token.role = profile.role;
          token.onboarding_done = profile.onboarding_done;
          token.enterprise_id = profile.enterprise_id;
          token.is_app_admin = profile.is_app_admin;
          if (profile.enterprise_id) {
            const { data: ent } = await supabase
              .from('enterprises')
              .select('name')
              .eq('id', profile.enterprise_id)
              .single();
            token.enterprise_name = ent?.name ?? null;
          } else {
            token.enterprise_name = null;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.onboarding_done = token.onboarding_done as boolean;
        session.user.enterprise_id = token.enterprise_id as string | null;
        session.user.enterprise_name = token.enterprise_name as string | null;
        session.user.is_app_admin = token.is_app_admin as boolean;
      }
      return session;
    },
  },
};

// Extend next-auth types
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: string;
      onboarding_done: boolean;
      enterprise_id: string | null;
      enterprise_name: string | null;
      is_app_admin: boolean;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    onboarding_done: boolean;
    enterprise_id: string | null;
    enterprise_name: string | null;
    is_app_admin: boolean;
  }
}
