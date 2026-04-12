import * as React from 'react';

interface SlackLogoProps extends React.SVGAttributes<SVGSVGElement> {
  /** Width/height in pixels. Default 20. */
  size?: number;
  /** Render in monochrome using currentColor. Default false (full-brand color). */
  mono?: boolean;
}

/**
 * Slack brand mark. Four-square hashtag glyph using Slack's official colors
 * (red, yellow, green, purple) when `mono` is false, or `currentColor`
 * otherwise.
 *
 * Source: Slack brand guidelines. https://slack.com/brand-guidelines
 */
export function SlackLogo({ size = 20, mono = false, ...rest }: SlackLogoProps) {
  const red = mono ? 'currentColor' : '#E01E5A';
  const green = mono ? 'currentColor' : '#2EB67D';
  const blue = mono ? 'currentColor' : '#36C5F0';
  const yellow = mono ? 'currentColor' : '#ECB22E';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 127 127"
      aria-hidden="true"
      {...rest}
    >
      <path fill={red} d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2S.8 87.3.8 80s5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2s13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2s-13.2-5.9-13.2-13.2V80z" />
      <path fill={blue} d="M47 27c-7.3 0-13.2-5.9-13.2-13.2S39.7.6 47 .6s13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2S54.3 60.1 47 60.1H13.9C6.6 60.1.7 54.2.7 46.9s5.9-13.2 13.2-13.2H47z" />
      <path fill={green} d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2s13.2 5.9 13.2 13.2-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2s-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6s13.2 5.9 13.2 13.2v33.1z" />
      <path fill={yellow} d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2s-5.9 13.2-13.2 13.2-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2s5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2s-5.9 13.2-13.2 13.2H80.1z" />
    </svg>
  );
}
