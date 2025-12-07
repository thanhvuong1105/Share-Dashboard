import React from "react";

type Coin = "BTC" | "ETH";

type Props = {
  coin: Coin;
  size?: number;
};

export const CoinLogo: React.FC<Props> = ({ coin, size = 18 }) => {
  const common = "inline-block";

  if (coin === "BTC") {
    // BTC: orange circle with classic ₿ mark
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        className={common}
        aria-hidden
      >
        <circle cx="16" cy="16" r="16" fill="#f7931a" />
        <path
          fill="#fff"
          d="M17.86 17.3c1.32-.2 2.14-1.06 2.06-2.33-.08-1.28-.9-1.9-2.17-2.08l.41-2.24-1.36-.25-.4 2.2-.93-.17.4-2.2-1.36-.25-.41 2.24-.82-.15-.17.93.82.15-.53 2.9-.82-.15-.17.93.82.15-.44 2.39 1.36.25.44-2.36.93.17-.44 2.36 1.36.25.44-2.38c1.5.27 2.71.13 3.03-1.38.15-.75-.06-1.37-.61-1.85Zm-3.59-3.27 2.06.37c.63.11.97.49.89 1.03-.09.5-.5.76-1.14.65l-2.03-.37Zm-.67 3.7.57-3.08 2.1.38c.7.13 1 .53.9 1.08-.1.56-.55.77-1.29.68l-2.28-.41Z"
        />
      </svg>
    );
  }

  // ETH: blue circle with white diamond
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={common}
      aria-hidden
    >
      <circle cx="16" cy="16" r="16" fill="#627eea" />
      <path
        fill="#fff"
        d="M16 6.5 10.5 16 16 13.4Zm0 0L21.5 16 16 13.4Zm0 19L10.5 19l5.5 3.1Zm0 0 5.5-6.5L16 22.1Zm0-7L10.5 16 16 13.9Zm0 0 5.5-3-5.5-2.1Z"
      />
    </svg>
  );
};
