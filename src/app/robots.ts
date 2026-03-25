import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacy', '/terms'],
        disallow: ['/dashboard', '/wallets', '/payments', '/swaps', '/invoices', '/transactions', '/treasury', '/compliance', '/yield', '/ramps', '/bank-accounts', '/audit', '/admin', '/setup', '/login', '/register', '/api/'],
      },
    ],
    sitemap: 'https://vantor.xyz/sitemap.xml',
  };
}
