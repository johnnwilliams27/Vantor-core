import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Terms & Conditions | Vantor',
};

const TOC = [
  { id: 'acceptance', label: 'Acceptance of Terms' },
  { id: 'description', label: 'Description of Service' },
  { id: 'eligibility', label: 'Eligibility' },
  { id: 'account', label: 'Account Registration' },
  { id: 'acceptable-use', label: 'Acceptable Use' },
  { id: 'financial-disclaimer', label: 'Financial Disclaimer' },
  { id: 'digital-assets', label: 'Digital Assets' },
  { id: 'non-custodial', label: 'Non-Custodial Platform' },
  { id: 'third-party', label: 'Third-Party Integrations' },
  { id: 'ip', label: 'Intellectual Property' },
  { id: 'data-ownership', label: 'Data Ownership' },
  { id: 'liability', label: 'Limitation of Liability' },
  { id: 'indemnification', label: 'Indemnification' },
  { id: 'termination', label: 'Termination' },
  { id: 'modifications', label: 'Modifications to Terms' },
  { id: 'governing-law', label: 'Governing Law' },
  { id: 'contact', label: 'Contact' },
];

function H2({ id, n, children }: { id: string; n: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-xl font-semibold text-white mb-3 scroll-mt-24">
      {n}. {children}
    </h2>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-void)] text-[var(--text-200)]">
      <nav className="sticky top-0 z-30 border-b border-white/[0.06] bg-[var(--bg-void)]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/">
            <Image src="/logo-dark.png" alt="Vantor" width={120} height={38} className="object-contain" unoptimized />
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-sm text-[var(--text-300)] hover:text-white transition-colors">
              Privacy
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
          <h1 className="text-3xl font-bold text-white mb-2">Terms &amp; Conditions</h1>
          <p className="text-sm text-[var(--text-400)] mb-10">Last updated: March 11, 2026</p>

          <div className="space-y-8 text-sm leading-relaxed">
            <section>
              <H2 id="acceptance" n={1}>Acceptance of Terms</H2>
              <p>By accessing or using the Vantor platform (&quot;Service&quot;), operated by Vantor Treasury, Inc. (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), you agree to be bound by these Terms &amp; Conditions (&quot;Terms&quot;). If you do not agree to these Terms, you may not use the Service.</p>
            </section>

            <section>
              <H2 id="description" n={2}>Description of Service</H2>
              <p>Vantor provides treasury automation software that enables organizations to connect ERP systems, digital asset wallets, and bank accounts for unified treasury visibility, automated yield deployment, compliance management, and related financial operations. The Service is intended for use by authorized business users only. Vantor does not provide investment advice, and customers retain all investment discretion over their treasury activities.</p>
            </section>

            <section>
              <H2 id="eligibility" n={3}>Eligibility</H2>
              <p>You must be at least 18 years old and have the legal authority to enter into these Terms on behalf of yourself or the organization you represent. By using the Service, you represent and warrant that you meet these requirements.</p>
            </section>

            <section>
              <H2 id="account" n={4}>Account Registration and Security</H2>
              <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account. We reserve the right to suspend or terminate accounts that violate these Terms.</p>
            </section>

            <section>
              <H2 id="acceptable-use" n={5}>Acceptable Use</H2>
              <p>You agree not to:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-[var(--text-300)]">
                <li>Use the Service for any unlawful purpose or in violation of any applicable laws or regulations</li>
                <li>Attempt to gain unauthorized access to any part of the Service or its related systems</li>
                <li>Interfere with or disrupt the integrity or performance of the Service</li>
                <li>Use the Service to process transactions involving sanctioned entities or jurisdictions</li>
                <li>Reverse engineer, decompile, or disassemble any aspect of the Service</li>
                <li>Use automated means to access the Service beyond approved API integrations</li>
              </ul>
            </section>

            <section>
              <H2 id="financial-disclaimer" n={6}>Financial Services Disclaimer</H2>
              <p>Vantor provides treasury automation software and does not provide financial, investment, tax, or legal advice. AI-generated proposals and risk scores are informational only and should not be construed as investment advice or recommendations to buy, sell, or hold any asset. Customers retain all investment discretion — all treasury decisions, including the deployment of reserves into yield opportunities, remain the sole responsibility of the user. You should consult with qualified professionals before making financial decisions. Vantor does not exercise discretion over user funds or assets; all instructions and authorizations are provided by the User.</p>
            </section>

            <section>
              <H2 id="digital-assets" n={7}>Digital Assets</H2>
              <p>Digital asset transactions are irreversible. We are not responsible for losses resulting from incorrect wallet addresses, network failures, smart contract vulnerabilities, or fluctuations in digital asset values. You acknowledge the inherent risks associated with digital assets and blockchain technology.</p>
            </section>

            <section>
              <H2 id="non-custodial" n={8}>Non-Custodial Platform; No Money Transmission</H2>
              <p>Vantor is a non-discretionary software platform. Vantor does not act as a money transmitter, money services business, payment processor, custodian, or financial institution. Vantor does not accept, hold, control, or transmit funds or digital assets on behalf of any user.</p>
              <p className="mt-2">All financial transactions, transfers, and transmissions are initiated solely by the User through the User&apos;s own accounts, wallets, and authorized third-party service providers. Vantor provides software tooling that enables Users to instruct and interact with those third-party providers. At no point does Vantor take possession, custody, or control of any fiat currency or digital assets.</p>
              <p className="mt-2">Users are solely responsible for compliance with all applicable laws and regulations governing their own financial activities, including money transmission laws, in their respective jurisdictions.</p>
            </section>

            <section>
              <H2 id="third-party" n={9}>Third-Party Integrations</H2>
              <p>The Service integrates with third-party services including, but not limited to, ERP systems, banking providers, blockchain networks, and compliance services. We are not responsible for the availability, accuracy, or performance of third-party services. Your use of third-party services is subject to their respective terms and conditions.</p>
            </section>

            <section>
              <H2 id="ip" n={10}>Intellectual Property</H2>
              <p>All content, features, and functionality of the Service, including but not limited to software, text, graphics, logos, and trademarks, are the exclusive property of Vantor Treasury, Inc. and are protected by applicable intellectual property laws. You are granted a limited, non-exclusive, non-transferable license to use the Service in accordance with these Terms.</p>
            </section>

            <section>
              <H2 id="data-ownership" n={11}>Data Ownership</H2>
              <p>You retain ownership of all data you input into the Service. By using the Service, you grant us a limited license to process, store, and transmit your data solely for the purpose of providing and improving the Service. We will not sell your data to third parties.</p>
            </section>

            <section>
              <H2 id="liability" n={12}>Limitation of Liability</H2>
              <p>To the maximum extent permitted by law, Vantor Treasury, Inc. shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, or other intangible losses, resulting from your use of or inability to use the Service. Our total aggregate liability shall not exceed the fees paid by you in the twelve (12) months preceding the claim.</p>
            </section>

            <section>
              <H2 id="indemnification" n={13}>Indemnification</H2>
              <p>You agree to indemnify, defend, and hold harmless Vantor Treasury, Inc. and its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses arising out of your use of the Service or violation of these Terms.</p>
            </section>

            <section>
              <H2 id="termination" n={14}>Termination</H2>
              <p>We may suspend or terminate your access to the Service at any time, with or without cause, upon reasonable notice. Upon termination, your right to use the Service will immediately cease. Provisions that by their nature should survive termination shall remain in effect.</p>
            </section>

            <section>
              <H2 id="modifications" n={15}>Modifications to Terms</H2>
              <p>We reserve the right to modify these Terms at any time. We will notify users of material changes via email or through the Service. Your continued use of the Service after such modifications constitutes acceptance of the updated Terms.</p>
            </section>

            <section>
              <H2 id="governing-law" n={16}>Governing Law</H2>
              <p>These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of law provisions. Any disputes arising from these Terms shall be resolved in the state or federal courts located in Delaware.</p>
            </section>

            <section>
              <H2 id="contact" n={17}>Contact</H2>
              <p>If you have questions about these Terms, please contact us at <a href="mailto:legal@vantor.xyz" className="text-[var(--teal-400)] hover:text-[var(--cyan-300)] transition-colors">legal@vantor.xyz</a>.</p>
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
