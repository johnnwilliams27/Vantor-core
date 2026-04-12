import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Privacy Policy | Vantor',
};

const TOC = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'info-collect', label: 'Information We Collect' },
  { id: 'info-use', label: 'How We Use Your Info' },
  { id: 'info-share', label: 'How We Share Your Info' },
  { id: 'security', label: 'Data Security' },
  { id: 'retention', label: 'Data Retention' },
  { id: 'rights', label: 'Your Rights' },
  { id: 'gdpr', label: 'GDPR' },
  { id: 'ccpa', label: 'CCPA' },
  { id: 'cookies', label: 'Cookies and Tracking' },
  { id: 'transfers', label: 'International Transfers' },
  { id: 'children', label: "Children's Privacy" },
  { id: 'changes', label: 'Changes to This Policy' },
  { id: 'contact', label: 'Contact Us' },
];

function H2({ id, n, children }: { id: string; n: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-xl font-semibold text-white mb-3 scroll-mt-24">
      {n}. {children}
    </h2>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-void)] text-[var(--text-200)]">
      <nav className="sticky top-0 z-30 border-b border-white/[0.06] bg-[var(--bg-void)]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/">
            <Image src="/logo-dark.png" alt="Vantor" width={120} height={38} className="object-contain" unoptimized />
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/terms" className="text-sm text-[var(--text-300)] hover:text-white transition-colors">
              Terms
            </Link>
            <Link href="/" className="text-sm text-[var(--text-300)] hover:text-white transition-colors">
              Back to Home
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-16 lg:flex lg:gap-16">
        {/* Sticky TOC sidebar — desktop only */}
        <aside className="hidden lg:block lg:w-56 shrink-0">
          <div className="sticky top-24">
            <p className="text-xs font-semibold uppercase text-[var(--teal-400)] mb-4" style={{ letterSpacing: '0.08em' }}>
              Contents
            </p>
            <nav className="space-y-1.5">
              {TOC.map((item, i) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="block text-xs text-[var(--text-400)] hover:text-white transition-colors leading-relaxed"
                >
                  {i + 1}. {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
          <p className="text-sm text-[var(--text-400)] mb-10">Last updated: April 4, 2026</p>

          <div className="space-y-8 text-sm leading-relaxed">
            <section>
              <H2 id="introduction" n={1}>Introduction</H2>
              <p>Vantor Treasury, Inc. (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use the Vantor platform (&quot;Service&quot;). By using the Service, you consent to the practices described in this policy.</p>
            </section>

            <section>
              <H2 id="info-collect" n={2}>Information We Collect</H2>
              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">2.1 Information You Provide</h3>
              <ul className="list-disc list-inside space-y-1 text-[var(--text-300)]">
                <li>Account registration information (name, email address, password)</li>
                <li>Organization and enterprise details</li>
                <li>Financial data imported from connected ERP systems, bank accounts, and digital asset wallets</li>
                <li>Transaction records and payment information</li>
                <li>Communications with us (contact form submissions, support requests)</li>
              </ul>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">2.2 Information Collected Automatically</h3>
              <ul className="list-disc list-inside space-y-1 text-[var(--text-300)]">
                <li>Device information (browser type, operating system, device identifiers)</li>
                <li>Usage data (pages visited, features used, timestamps)</li>
                <li>IP address and approximate geographic location</li>
                <li>Error logs and performance data (via Sentry)</li>
              </ul>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">2.3 Information from Third Parties</h3>
              <ul className="list-disc list-inside space-y-1 text-[var(--text-300)]">
                <li>Financial account data from Plaid or other banking integrations</li>
                <li>Blockchain data from public networks (wallet balances, transaction history)</li>
                <li>Compliance screening results from Chainalysis or similar providers</li>
                <li>ERP data from connected systems (invoices, vendors, GL entries)</li>
              </ul>
            </section>

            <section>
              <H2 id="info-use" n={3}>How We Use Your Information</H2>
              <p>We use your information to:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
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
              <H2 id="info-share" n={4}>How We Share Your Information</H2>
              <p>We do not sell your personal information. We may share your information with:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
                <li><strong className="text-[var(--text-100)]">Service providers:</strong> Third-party services that help us operate the platform (e.g., Supabase for data storage, Plaid for banking, Chainalysis for compliance, Anthropic for AI features, Sentry for error tracking)</li>
                <li><strong className="text-[var(--text-100)]">Compliance authorities:</strong> When required by law, regulation, or legal process</li>
                <li><strong className="text-[var(--text-100)]">Business transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
                <li><strong className="text-[var(--text-100)]">With your consent:</strong> When you explicitly authorize sharing</li>
              </ul>
            </section>

            <section>
              <H2 id="security" n={5}>Data Security</H2>
              <p>We implement industry-standard security measures to protect your information, including:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
                <li>Encryption of data in transit (TLS) and at rest</li>
                <li>Role-based access control (RBAC) with least-privilege principles</li>
                <li>Row-level security (RLS) policies for data isolation between enterprises</li>
                <li>Comprehensive audit logging of all sensitive operations</li>
                <li>Regular security assessments and monitoring</li>
              </ul>
              <p className="mt-2">No method of transmission or storage is 100% secure. While we strive to protect your information, we cannot guarantee absolute security.</p>
            </section>

            <section>
              <H2 id="retention" n={6}>Data Retention</H2>
              <p>We retain your information for as long as your account is active or as needed to provide the Service. We may also retain certain information as required by law, for audit purposes, or to resolve disputes. Upon account termination, we will delete or anonymize your personal data within 90 days, except where retention is required by law.</p>
            </section>

            <section>
              <H2 id="rights" n={7}>Your Rights</H2>
              <p>Depending on your jurisdiction, you may have the right to:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
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
              <H2 id="gdpr" n={8}>GDPR — European Economic Area</H2>
              <p>If you are located in the European Economic Area (EEA), the United Kingdom, or Switzerland, the following additional provisions apply:</p>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">8.1 Legal Basis for Processing</h3>
              <p className="text-[var(--text-300)]">We process your personal data on the following legal bases:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
                <li><strong className="text-[var(--text-100)]">Contract performance:</strong> Processing necessary to provide the Service you requested</li>
                <li><strong className="text-[var(--text-100)]">Legitimate interests:</strong> Analytics, fraud prevention, security monitoring, and Service improvement</li>
                <li><strong className="text-[var(--text-100)]">Legal obligation:</strong> Compliance screening, regulatory reporting, and record-keeping</li>
                <li><strong className="text-[var(--text-100)]">Consent:</strong> Where required, such as for optional communications</li>
              </ul>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">8.2 Your GDPR Rights</h3>
              <p className="text-[var(--text-300)]">In addition to the rights listed in Section 7, you have the right to:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
                <li>Lodge a complaint with your local data protection supervisory authority</li>
                <li>Request restriction of processing while a complaint is being resolved</li>
                <li>Object to processing based on legitimate interests</li>
              </ul>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">8.3 International Transfers</h3>
              <p className="text-[var(--text-300)]">When we transfer personal data outside the EEA, we rely on Standard Contractual Clauses approved by the European Commission or other legally recognized transfer mechanisms.</p>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">8.4 Contact</h3>
              <p className="text-[var(--text-300)]">For GDPR-related inquiries, contact our data protection team at <a href="mailto:privacy@vantor.xyz" className="text-teal-400 hover:text-teal-300 transition-colors">privacy@vantor.xyz</a>.</p>
            </section>

            <section>
              <H2 id="ccpa" n={9}>CCPA — California Residents</H2>
              <p>If you are a California resident, the California Consumer Privacy Act (CCPA) and the California Privacy Rights Act (CPRA) provide you with additional rights regarding your personal information.</p>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">9.1 Do Not Sell or Share</h3>
              <p className="text-[var(--text-300)]">Vantor does not sell your personal information to third parties. We do not share your personal information for cross-context behavioral advertising.</p>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">9.2 Categories Collected</h3>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
                <li><strong className="text-[var(--text-100)]">Identifiers:</strong> Name, email address, IP address, wallet addresses</li>
                <li><strong className="text-[var(--text-100)]">Financial information:</strong> Bank account details, transaction records, digital asset holdings</li>
                <li><strong className="text-[var(--text-100)]">Commercial information:</strong> Invoice data, payment history, ERP records</li>
                <li><strong className="text-[var(--text-100)]">Internet activity:</strong> Usage data, pages visited, feature interactions</li>
                <li><strong className="text-[var(--text-100)]">Professional information:</strong> Organization name, role, business details</li>
              </ul>

              <h3 className="text-base font-medium text-[var(--text-100)] mt-4 mb-2">9.3 Your CCPA Rights</h3>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
                <li>Know what personal information we collect, use, and disclose</li>
                <li>Request deletion of your personal information</li>
                <li>Request correction of inaccurate personal information</li>
                <li>Not be discriminated against for exercising your privacy rights</li>
                <li>Designate an authorized agent to submit requests on your behalf</li>
              </ul>
              <p className="mt-2 text-[var(--text-300)]">To exercise these rights, contact us at <a href="mailto:privacy@vantor.xyz" className="text-teal-400 hover:text-teal-300 transition-colors">privacy@vantor.xyz</a>.</p>
            </section>

            <section>
              <H2 id="cookies" n={10}>Cookies and Tracking</H2>
              <p>We use essential cookies for authentication and session management. We use Sentry for error tracking and performance monitoring. We do not use third-party advertising cookies or trackers. You can manage cookie preferences through your browser settings.</p>
            </section>

            <section>
              <H2 id="transfers" n={11}>International Data Transfers</H2>
              <p>Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place for such transfers in compliance with applicable data protection laws.</p>
            </section>

            <section>
              <H2 id="children" n={12}>Children&apos;s Privacy</H2>
              <p>The Service is not intended for individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child, we will take steps to delete it promptly.</p>
            </section>

            <section>
              <H2 id="changes" n={13}>Changes to This Policy</H2>
              <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on the Service and updating the &quot;Last updated&quot; date. Your continued use of the Service after changes constitutes acceptance of the updated policy.</p>
            </section>

            <section>
              <H2 id="contact" n={14}>Contact Us</H2>
              <p>If you have questions or concerns about this Privacy Policy or our data practices, please contact us at:</p>
              <div className="mt-3 text-[var(--text-300)]">
                <p>Vantor Treasury, Inc.</p>
                <p>Email: <a href="mailto:privacy@vantor.xyz" className="text-teal-400 hover:text-teal-300 transition-colors">privacy@vantor.xyz</a></p>
              </div>
            </section>
          </div>
        </main>
      </div>

      <footer className="border-t border-white/[0.06] py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-[var(--text-400)]">
          &copy; {new Date().getFullYear()} Vantor Treasury, Inc. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
