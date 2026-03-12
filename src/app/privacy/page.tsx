import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Privacy Policy | Vantor',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#060d1f] text-gray-300">
      <nav className="border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/">
            <Image src="/logo-dark.png" alt="Vantor" width={120} height={38} className="object-contain" unoptimized />
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
            Back to Home
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: March 11, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Introduction</h2>
            <p>Vantor Treasury, Inc. (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use the Vantor platform (&quot;Service&quot;). By using the Service, you consent to the practices described in this policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Information We Collect</h2>
            <h3 className="text-base font-medium text-gray-200 mt-4 mb-2">2.1 Information You Provide</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>Account registration information (name, email address, password)</li>
              <li>Organization and enterprise details</li>
              <li>Financial data imported from connected ERP systems, bank accounts, and digital asset wallets</li>
              <li>Transaction records and payment information</li>
              <li>Communications with us (contact form submissions, support requests)</li>
            </ul>

            <h3 className="text-base font-medium text-gray-200 mt-4 mb-2">2.2 Information Collected Automatically</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>Device information (browser type, operating system, device identifiers)</li>
              <li>Usage data (pages visited, features used, timestamps)</li>
              <li>IP address and approximate geographic location</li>
              <li>Error logs and performance data (via Sentry)</li>
            </ul>

            <h3 className="text-base font-medium text-gray-200 mt-4 mb-2">2.3 Information from Third Parties</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>Financial account data from Plaid or other banking integrations</li>
              <li>Blockchain data from public networks (wallet balances, transaction history)</li>
              <li>Compliance screening results from Chainalysis or similar providers</li>
              <li>ERP data from connected systems (invoices, vendors, GL entries)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
              <li>Provide, maintain, and improve the Service</li>
              <li>Process transactions and manage treasury operations</li>
              <li>Generate AI-powered treasury recommendations and forecasts</li>
              <li>Perform compliance screening and regulatory checks</li>
              <li>Send transactional emails and system notifications</li>
              <li>Monitor for fraud, security threats, and unauthorized access</li>
              <li>Respond to your inquiries and provide customer support</li>
              <li>Comply with legal obligations and regulatory requirements</li>
              <li>Generate aggregated, anonymized analytics to improve the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. How We Share Your Information</h2>
            <p>We do not sell your personal information. We may share your information with:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
              <li><strong className="text-gray-200">Service providers:</strong> Third-party services that help us operate the platform (e.g., Supabase for data storage, Plaid for banking, Chainalysis for compliance, Anthropic for AI features, Sentry for error tracking)</li>
              <li><strong className="text-gray-200">Compliance authorities:</strong> When required by law, regulation, or legal process</li>
              <li><strong className="text-gray-200">Business transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
              <li><strong className="text-gray-200">With your consent:</strong> When you explicitly authorize sharing</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Data Security</h2>
            <p>We implement industry-standard security measures to protect your information, including:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
              <li>Encryption of data in transit (TLS) and at rest</li>
              <li>Role-based access control (RBAC) with least-privilege principles</li>
              <li>Row-level security (RLS) policies for data isolation between enterprises</li>
              <li>Comprehensive audit logging of all sensitive operations</li>
              <li>Regular security assessments and monitoring</li>
            </ul>
            <p className="mt-2">No method of transmission or storage is 100% secure. While we strive to protect your information, we cannot guarantee absolute security.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Data Retention</h2>
            <p>We retain your information for as long as your account is active or as needed to provide the Service. We may also retain certain information as required by law, for audit purposes, or to resolve disputes. Upon account termination, we will delete or anonymize your personal data within 90 days, except where retention is required by law.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate or incomplete data</li>
              <li>Request deletion of your personal data</li>
              <li>Object to or restrict certain processing of your data</li>
              <li>Request portability of your data in a structured format</li>
              <li>Withdraw consent at any time (where processing is based on consent)</li>
            </ul>
            <p className="mt-2">To exercise these rights, contact us at <a href="mailto:privacy@vantor.xyz" className="text-teal-400 hover:text-teal-300 transition-colors">privacy@vantor.xyz</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Cookies and Tracking</h2>
            <p>We use essential cookies for authentication and session management. We use Sentry for error tracking and performance monitoring. We do not use third-party advertising cookies or trackers. You can manage cookie preferences through your browser settings.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. International Data Transfers</h2>
            <p>Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place for such transfers in compliance with applicable data protection laws.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Children&apos;s Privacy</h2>
            <p>The Service is not intended for individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child, we will take steps to delete it promptly.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on the Service and updating the &quot;Last updated&quot; date. Your continued use of the Service after changes constitutes acceptance of the updated policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">12. Contact Us</h2>
            <p>If you have questions or concerns about this Privacy Policy or our data practices, please contact us at:</p>
            <div className="mt-3 text-gray-400">
              <p>Vantor Treasury, Inc.</p>
              <p>Email: <a href="mailto:privacy@vantor.xyz" className="text-teal-400 hover:text-teal-300 transition-colors">privacy@vantor.xyz</a></p>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-white/[0.06] py-8">
        <div className="max-w-4xl mx-auto px-6 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} Vantor Treasury, Inc. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
