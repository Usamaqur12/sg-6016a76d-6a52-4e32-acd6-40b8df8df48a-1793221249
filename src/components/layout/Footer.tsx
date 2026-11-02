import Link from "next/link";
import { Facebook, Twitter, Instagram, Youtube } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";

export function Footer() {
  const footerLinks = {
    company: [
      { label: "About Us", href: "/about" },
      { label: "Contact Us", href: "/contact" },
      { label: "Careers", href: "/careers" },
      { label: "Brokers & Agents", href: "/broker" },
    ],
    support: [
      { label: "Help Center", href: "/help" },
      { label: "Terms & Conditions", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Responsible Gambling", href: "/responsible-gambling" },
    ],
    products: [
      { label: "Sports Betting", href: "/sports" },
      { label: "Live Betting", href: "/live" },
      { label: "Casino", href: "/casino" },
      { label: "Esports", href: "/esports" },
    ],
  };

  const socialLinks = [
    { icon: Facebook, href: process.env.NEXT_PUBLIC_FACEBOOK_URL, label: "Facebook" },
    { icon: Twitter, href: process.env.NEXT_PUBLIC_TWITTER_URL, label: "Twitter" },
    { icon: Instagram, href: process.env.NEXT_PUBLIC_INSTAGRAM_URL, label: "Instagram" },
    { icon: Youtube, href: process.env.NEXT_PUBLIC_YOUTUBE_URL, label: "YouTube" },
  ].filter((social): social is { icon: typeof Facebook; href: string; label: string } => Boolean(social.href && /^https:\/\//i.test(social.href)));

  return (
    <footer className="border-t border-border bg-surface mt-12">
      <div className="container py-8 px-4">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div>
            <BrandLogo className="mb-3" />
            <p className="text-sm text-muted-foreground">
              Premium sportsbook experience with the best odds, live betting, and casino games.
            </p>
            {socialLinks.length > 0 && <div className="flex items-center gap-2">
              {socialLinks.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    className="w-8 h-8 rounded bg-surface-elevated border border-border hover:border-primary/40 hover:bg-primary/10 flex items-center justify-center transition-all"
                    aria-label={social.label}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                );
              })}
            </div>}
          </div>

          {/* Links Columns */}
          <div>
            <h4 className="text-sm font-bold mb-3">Company</h4>
            <ul className="space-y-2">
              {footerLinks.company.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-xs text-subtle-foreground hover:text-primary transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold mb-3">Support</h4>
            <ul className="space-y-2">
              {footerLinks.support.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-xs text-subtle-foreground hover:text-primary transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold mb-3">Products</h4>
            <ul className="space-y-2">
              {footerLinks.products.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-xs text-subtle-foreground hover:text-primary transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-6 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © 2026 MindBet Pro. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-subtle-foreground">18+ Only</span>
            <span className="text-xs text-subtle-foreground">·</span>
            <span className="text-xs text-subtle-foreground">Gamble Responsibly</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
