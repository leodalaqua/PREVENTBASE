import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

const DEVICE_SCRIPT = `(function(){var d=document.documentElement,t;function u(){var w=window.innerWidth,h=window.innerHeight;d.setAttribute('data-device',w<640?'mobile':w<1024?'tablet':'desktop');d.setAttribute('data-pointer',matchMedia('(pointer: coarse)').matches?'coarse':'fine');d.setAttribute('data-orientation',w>h?'landscape':'portrait')}u();addEventListener('resize',function(){cancelAnimationFrame(t);t=requestAnimationFrame(u)});addEventListener('orientationchange',u)})();`;

export const metadata: Metadata = {
  title: { default: "PreventBase", template: "%s · PreventBase" },
  description: "Hub de SST — EPI, estoque, CA e entrega com biometria facial.",
  applicationName: "PreventBase",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "PreventBase", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#18181b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DEVICE_SCRIPT }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
