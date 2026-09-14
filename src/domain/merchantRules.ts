import type { MerchantRule } from './types';

/** Built-in keyword → category rules for common Indian UPI / card merchants. */
export const DEFAULT_RULES: ReadonlyArray<Omit<MerchantRule, 'id'>> = [
  // Food delivery
  ...['SWIGGY', 'ZOMATO', 'EATSURE', 'DOMINOS', 'FAASOS', 'BOX8'].map((k) => ({ keyword: k, categoryId: 'delivery' })),
  // Quick commerce & groceries
  ...['ZEPTO', 'BLINKIT', 'INSTAMART', 'BIGBASKET', 'DMART', 'JIOMART', 'SWIGGY INSTAMART'].map((k) => ({
    keyword: k,
    categoryId: 'groceries',
  })),
  // Eating out
  ...['STARBUCKS', 'CHAAYOS', 'CAFE', 'CANTEEN', 'MCDONALD', 'KFC', 'BURGER KING', 'SUBWAY', 'THIRD WAVE', 'RESTAURANT'].map(
    (k) => ({ keyword: k, categoryId: 'food_out' }),
  ),
  // Local transport
  ...['MUMBAI METRO', 'MMOPL', 'BEST', 'UTS', 'M-INDICATOR', 'CHALO', 'RAILWAY', 'IRCTC UTS'].map((k) => ({
    keyword: k,
    categoryId: 'local_travel',
  })),
  // Cabs & autos
  ...['UBER', 'OLA', 'RAPIDO', 'NAMMA YATRI', 'BLUSMART'].map((k) => ({ keyword: k, categoryId: 'cabs' })),
  // Trips home
  ...['IRCTC', 'REDBUS', 'MAKEMYTRIP', 'INDIGO', 'GOIBIBO', 'IXIGO', 'ABHIBUS'].map((k) => ({
    keyword: k,
    categoryId: 'trips',
  })),
  // Recharge
  ...['JIO', 'AIRTEL', 'VODAFONE', 'VI RECHARGE', 'BSNL', 'ACT FIBERNET', 'HATHWAY'].map((k) => ({
    keyword: k,
    categoryId: 'recharge',
  })),
  // Subscriptions
  ...['NETFLIX', 'SPOTIFY', 'HOTSTAR', 'PRIME VIDEO', 'YOUTUBE', 'APPLE.COM', 'GOOGLE PLAY', 'SONYLIV', 'CHATGPT', 'OPENAI'].map(
    (k) => ({ keyword: k, categoryId: 'subscriptions' }),
  ),
  // Shopping
  ...['AMAZON', 'FLIPKART', 'MYNTRA', 'AJIO', 'MEESHO', 'NYKAA', 'DECATHLON', 'H&M', 'ZARA'].map((k) => ({
    keyword: k,
    categoryId: 'shopping',
  })),
  // Outings
  ...['BOOKMYSHOW', 'PVR', 'INOX', 'DISTRICT', 'PAYTM INSIDER', 'TIMEZONE', 'SMAAASH'].map((k) => ({
    keyword: k,
    categoryId: 'outings',
  })),
  // Health
  ...['APOLLO', 'PHARMEASY', 'NETMEDS', '1MG', 'TATA 1MG', 'MEDPLUS', 'WELLNESS FOREVER', 'CHEMIST', 'CLINIC'].map((k) => ({
    keyword: k,
    categoryId: 'health',
  })),
  // College
  ...['UNIVERSITY', 'COLLEGE', 'XEROX', 'STATIONERY', 'COURSERA', 'UDEMY', 'EXAM FEE'].map((k) => ({
    keyword: k,
    categoryId: 'college',
  })),
  // Personal care
  ...['LAUNDRY', 'DHOBI', 'SALON', 'URBAN COMPANY'].map((k) => ({ keyword: k, categoryId: 'personal' })),
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pick a category for a free-text description. User rules win over built-ins,
 * and longer keywords win over shorter ones ("SWIGGY INSTAMART" beats "SWIGGY").
 * Keywords must match on word boundaries so "BEST" doesn't match "BESTSELLER".
 */
export function categorise(description: string, userRules: ReadonlyArray<Omit<MerchantRule, 'id'>> = []): string | undefined {
  const text = description.toUpperCase();
  const find = (rules: ReadonlyArray<Omit<MerchantRule, 'id'>>) =>
    [...rules]
      .sort((a, b) => b.keyword.length - a.keyword.length)
      .find((r) => new RegExp(`(^|[^A-Z0-9])${escape(r.keyword.toUpperCase())}([^A-Z0-9]|$)`).test(text));
  return (find(userRules) ?? find(DEFAULT_RULES))?.categoryId;
}

/**
 * Extract a readable merchant name from a UPI / bank narration such as
 * "UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy@ybl/Payment" → "Swiggy Limited".
 */
export function extractMerchant(description: string): string {
  let text = description.trim();
  if (/^(UPI|IMPS|NEFT|POS|ECOM)[/\- ]/i.test(text)) {
    const parts = text.split(text.includes('/') ? '/' : '-').map((p) => p.trim());
    const candidate = parts.find(
      (p, i) =>
        i > 0 &&
        p.length > 2 &&
        !/\d{5,}/.test(p) && // reference numbers
        !/^(UPI|DR|CR|IMPS|NEFT|NEFT CR|NEFT DR|IMPS CR|POS|ECOM|P2M|P2A|PAYMENT|PAY|SENT|RECEIVED)$/i.test(p) &&
        !/@/.test(p) &&
        !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(p) && // IFSC codes like YESB0000001
        !/^(YESB|HDFC|ICIC|SBIN|UTIB|KKBK|PUNB|BARB|IDIB|AIRP|PYTM)$/i.test(p), // bare bank codes
    );
    if (candidate) text = candidate;
  }
  text = text.replace(/\s+/g, ' ').slice(0, 40);
  return text
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
