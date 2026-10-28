import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLocale = "en" | "ur";

const messages = {
  en: {
    sports: "Sports", live: "Live", casino: "Casino", esports: "Esports", promotions: "Promotions",
    search: "Search...", demoWallet: "Demo Wallet", wallet: "Wallet", rewards: "Rewards", notifications: "Notifications",
    unread: "unread", markAllRead: "Mark all read", noNotifications: "No notifications yet",
    myAccount: "My Account", myBets: "My Bets", settings: "Settings", logout: "Logout",
    login: "Login", register: "Register", home: "Home", account: "Account", demoAccount: "Demo account",
  },
  ur: {
    sports: "کھیل", live: "لائیو", casino: "کیسینو", esports: "ای اسپورٹس", promotions: "پروموشنز",
    search: "تلاش کریں...", demoWallet: "ڈیمو والیٹ", wallet: "والیٹ", rewards: "انعامات", notifications: "اطلاعات",
    unread: "نئی", markAllRead: "سب کو پڑھا ہوا کریں", noNotifications: "ابھی کوئی اطلاع نہیں",
    myAccount: "میرا اکاؤنٹ", myBets: "میری بیٹس", settings: "ترتیبات", logout: "لاگ آؤٹ",
    login: "لاگ اِن", register: "رجسٹر", home: "ہوم", account: "اکاؤنٹ", demoAccount: "ڈیمو اکاؤنٹ",
  },
} as const;

export type MessageKey = keyof typeof messages.en;
type I18nValue = { locale: AppLocale; setLocale: (locale: AppLocale) => void; t: (key: MessageKey) => string };
const I18nContext = createContext<I18nValue>({ locale: "en", setLocale: () => undefined, t: (key) => messages.en[key] });

function readLocale(): AppLocale {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem("primebet-locale") === "ur" ? "ur" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("en");
  useEffect(() => {
    const apply = (next: AppLocale) => { setLocaleState(next); document.documentElement.lang = next; document.documentElement.dir = next === "ur" ? "rtl" : "ltr"; };
    apply(readLocale());
    const onLocale = (event: Event) => apply(((event as CustomEvent<AppLocale>).detail === "ur" ? "ur" : "en"));
    window.addEventListener("primebet:locale", onLocale);
    return () => window.removeEventListener("primebet:locale", onLocale);
  }, []);
  const setLocale = (next: AppLocale) => { if (typeof window !== "undefined") { window.localStorage.setItem("primebet-locale", next); window.dispatchEvent(new CustomEvent("primebet:locale", { detail: next })); } };
  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (key) => messages[locale][key] }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }

