'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function NavigationProgress() {
  const pathname = usePathname();
  const [animKey, setAnimKey] = useState(0);
  const prevRef = useRef(pathname);

  useEffect(() => {
    if (pathname !== prevRef.current) {
      prevRef.current = pathname;
      setAnimKey((k) => k + 1);
    }
  }, [pathname]);

  return (
    <div key={animKey} className="nav-progress-bar" aria-hidden="true" />
  );
}
