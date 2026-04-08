import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Terms & Conditions | Vantor',
};

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold text-white mb-2">Terms &amp; Conditions</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: March 11, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>By accessing or using the Vantor platform (&quot;Service&quot;), operated by Vantor Treasury, Inc. (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), you agree to be bound by these Terms &amp; Conditions (&quot;Terms&quot;). If you do not agree to these Terms, you may not use the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Description of Service</h2>
            <p>Vantor provides treasury automation software that enables organizations to connect ERP systems, digital asset wallets, and bank accounts for unified treasury visibility, automated yield deployment, compliance management, and related financial operations. The Service is intended for use by authorized business users only. Vantor does not provide investment advice, and customers retain all investment discretion over their treasury activities.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Eligibility</h2>
            <p>You must be at least 18 years old and have the legal authority to enter into these Terms on behalf of yourself or the organization you represent. By using the Service, you represent and warrant that you meet these requirements.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Account Registration and Security</h2>
            <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account. We reserve the right to suspend or terminate accounts that violate these Terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
              <li>Use the Service for any unlawful purpose or in violation of any applicable laws or regulations</li>
              <li>Attempt to gain unauthorized access to any part of the Service or its related systems</li>
              <li>Interfere with or disrupt the integrity or performance of the Service</li>
              <li>Use the Service to process transactions involving sanctioned entities or jurisdictions</li>
              <li>Reverse engineer, decompile, or disassemble any aspect of the Service</li>
              <li>Use automated means to access the Service beyond approved API integrations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Financial Services Disclaimer</h2>
            <p>Vantor provides treasury automation software and does not provide financial, investment, tax, or legal advice. AI-generated proposals and risk scores are informational only and should not be construed as investment advice or recommendations to buy, sell, or hold any asset. Customers retain all investment discretion — all treasury decisions, including the deployment of reserves into yield opportunities, remain the sole responsibility of the user. You should consult with qualified professionals before making financial decisions. Vantor does not exercise discretion over user funds or assets; all instructions and authorizations are provided by the User.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Digital Assets</h2>
            <p>Digital asset transactions are irreversible. We are not responsible for losses resulting from incorrect wallet addresses, network failures, smart contract vulnerabilities, or fluctuations in digital asset values. You acknowledge the inherent risks associated with digital assets and blockchain technology.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Non-Custodial Platform; No Money Transmission</h2>
            <p>Vantor is a non-discretionary software platform. Vantor does not act as a money transmitter, money services business, payment processor, custodian, or financial institution. Vantor does not accept, hold, control, or transmit funds or digital assets on behalf of any user.</p>
            <p className="mt-2">All financial transactions, transfers, and transmissions are initiated solely by the User through the User&apos;s own accounts, wallets, and authorized third-party service providers. Vantor provides software tooling that enables Users to instruct and interact with those third-party providers. At no point does Vantor take possession, custody, or control of any fiat currency or digital assets.</p>
            <p className="mt-2">Users are solely responsible for compliance with all applicable laws and regulations governing their own financial activities, including money transmission laws, in their respective jurisdictions.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Third-Party Integrations</h2>
            <p>The Service integrates with third-party services including, but not limited to, ERP systems, banking providers, blockchain networks, and compliance services. We are not responsible for the availability, accuracy, or performance of third-party services. Your use of third-party services is subject to their respective terms and conditions.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Intellectual Property</h2>
            <p>All content, features, and functionality of the Service, including but not limited to software, text, graphics, logos, and trademarks, are the exclusive property of Vantor Treasury, Inc. and are protected by applicable intellectual property laws. You are granted a limited, non-exclusive, non-transferable license to use the Service in accordance with these Terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Data Ownership</h2>
            <p>You retain ownership of all data you input into the Service. By using the Service, you grant us a limited license to process, store, and transmit your data solely for the purpose of providing and improving the Service. We will not sell your data to third parties.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">12. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Vantor Treasury, Inc. shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, or other intangible losses, resulting from your use of or inability to use the Service. Our total aggregate liability shall not exceed the fees paid by you in the twelve (12) months preceding the claim.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">13. Indemnification</h2>
            <p>You agree to indemnify, defend, and hold harmless Vantor Treasury, Inc. and its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses arising out of your use of the Service or violation of these Terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">14. Termination</h2>
            <p>We may suspend or terminate your access to the Service at any time, with or without cause, upon reasonable notice. Upon termination, your right to use the Service will immediately cease. Provisions that by their nature should survive termination shall remain in effect.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">15. Modifications to Terms</h2>
            <p>We reserve the right to modify these Terms at any time. We will notify users of material changes via email or through the Service. Your continued use of the Service after such modifications constitutes acceptance of the updated Terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">16. Governing Law</h2>
            <p>These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of law provisions. Any disputes arising from these Terms shall be resolved in the state or federal courts located in Delaware.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">17. Contact</h2>
            <p>If you have questions about these Terms, please contact us at <a href="mailto:legal@vantor.xyz" className="text-teal-400 hover:text-teal-300 transition-colors">legal@vantor.xyz</a>.</p>
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
