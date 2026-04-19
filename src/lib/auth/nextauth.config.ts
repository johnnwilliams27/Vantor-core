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

        // Block login if email not verified
        if (profile && !profile.email_verified) {
          return null;
        }

        let enterpriseName: string | null = null;
        let enterpriseCountry: string | null = null;
        let enterpriseStatus: string | null = null;
        if (profile?.enterprise_id) {
          const { data: ent } = await supabase
            .from('enterprises')
            .select('name, country, status')
            .eq('id', profile.enterprise_id)
            .single();
          enterpriseName = ent?.name ?? null;
          enterpriseCountry = ent?.country ?? null;
          enterpriseStatus = ent?.status ?? null;
        }

        // Block login when the user's enterprise is frozen. App admins bypass
        // so they can unfreeze from the admin dashboard.
        if (enterpriseStatus === 'frozen' && !profile?.is_app_admin) {
          return null;
        }

        let subscriptionTier = 'lite';
        let kycStatus = 'none';
        let kybStatus = 'none';

        if (profile?.enterprise_id) {
          const { data: subscription } = await supabase
            .from('subscriptions')
            .select('tier')
            .eq('enterprise_id', profile.enterprise_id)
            .single();
          subscriptionTier = subscription?.tier || 'lite';

          const { data: kyb } = await supabase
            .from('kyb_verifications')
            .select('status')
            .eq('enterprise_id', profile.enterprise_id)
            .single();
          kybStatus = kyb?.status || 'none';
        }

        const { data: kyc } = await supabase
          .from('kyc_verifications')
          .select('status')
          .eq('user_id', data.user.id)
          .single();
        kycStatus = kyc?.status || 'none';

        return {
          id: data.user.id,
          email: data.user.email!,
          name: profile?.full_name ?? data.user.email,
          role: profile?.role ?? 'auditor',
          onboarding_done: profile?.onboarding_done ?? false,
          enterprise_id: profile?.enterprise_id ?? null,
          enterprise_name: enterpriseName,
          enterprise_country: enterpriseCountry,
          enterprise_status: enterpriseStatus,
          is_app_admin: profile?.is_app_admin ?? false,
          subscription_tier: subscriptionTier,
          kyc_status: kycStatus,
          kyb_status: kybStatus,
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
        token.enterprise_country =
          (user as { enterprise_country?: string | null }).enterprise_country ?? null;
        token.enterprise_status =
          (user as { enterprise_status?: string | null }).enterprise_status ?? null;
        token.is_app_admin =
          (user as { is_app_admin?: boolean }).is_app_admin ?? false;
        token.subscription_tier = (user as any).subscription_tier ?? 'lite';
        token.subscription_status = (user as any).subscription_status ?? 'active';
        token.kyc_status = (user as any).kyc_status ?? 'none';
        token.kyb_status = (user as any).kyb_status ?? 'none';
      }
      // Re-fetch from DB whenever the session is explicitly updated
      // (e.g. after completing onboarding)
      if ((trigger === 'update' || trigger === 'signIn') && token.id) {
        process.stdout.write('[jwt] refreshing token for trigger=' + trigger + ' user=' + token.id + '\n');
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
              .select('name, country, status')
              .eq('id', profile.enterprise_id)
              .single();
            token.enterprise_name = ent?.name ?? null;
            token.enterprise_country = ent?.country ?? null;
            token.enterprise_status = ent?.status ?? null;
          } else {
            token.enterprise_name = null;
            token.enterprise_country = null;
            token.enterprise_status = null;
          }

          if (profile.enterprise_id) {
            const { data: sub } = await supabase
              .from('subscriptions')
              .select('tier, status')
              .eq('enterprise_id', profile.enterprise_id)
              .single();
            token.subscription_tier = sub?.tier || 'lite';
            token.subscription_status = sub?.status || 'active';

            const { data: kyb } = await supabase
              .from('kyb_verifications')
              .select('status')
              .eq('enterprise_id', profile.enterprise_id)
              .single();
            token.kyb_status = kyb?.status || 'none';
          } else {
            token.subscription_tier = 'lite';
            token.subscription_status = 'active';
            token.kyb_status = 'none';
          }

          const { data: kyc } = await supabase
            .from('kyc_verifications')
            .select('status')
            .eq('user_id', token.id)
            .single();
          token.kyc_status = kyc?.status || 'none';
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
        session.user.enterprise_country = token.enterprise_country as string | null;
        session.user.enterprise_status = token.enterprise_status as string | null;
        session.user.is_app_admin = token.is_app_admin as boolean;
        session.user.subscription_tier = token.subscription_tier as string;
        session.user.subscription_status = token.subscription_status as string;
        session.user.kyc_status = token.kyc_status as string;
        session.user.kyb_status = token.kyb_status as string;
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
      enterprise_country: string | null;
      enterprise_status: string | null;
      is_app_admin: boolean;
      subscription_tier: string;
      subscription_status: string;
      kyc_status: string;
      kyb_status: string;
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
    enterprise_country: string | null;
    enterprise_status: string | null;
    is_app_admin: boolean;
    subscription_tier: string;
    subscription_status: string;
    kyc_status: string;
    kyb_status: string;
  }
}
