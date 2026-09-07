// Real Revo Fixer Firebase data shapes (mirrors the app's own schema).

export interface AppDiscount {
  active: boolean;
  message?: string;
  percent: number;
  updatedAt?: number;
}

export interface PaymentSettings {
  minDepositINR: number;
  usdtRate: number;
  updatedAt?: number;
}

export interface WalletTransfer {
  enabled: boolean;
  message?: string;
  minAmount: number;
  status?: string;
  updatedAt?: number;
}

export interface AppSettings {
  appName: string;
  appTagline: string;
  appVersion: string;
  discount: AppDiscount;
  downloadLink?: string;
  forceUpdate: boolean;
  maintenanceMessage?: string;
  maintenanceMode: boolean;
  paymentSettings: PaymentSettings;
  supportContact?: string;
  supportEmail?: string;
  telegramLink?: string;
  updateMessage?: string;
  updatedAt?: number;
  walletTransfer?: WalletTransfer;
}

export interface Package {
  id: string;
  name: string;
  price: number;
  hours: number;
  icon?: string;
  desc?: string;
  popular?: boolean;
  active?: boolean;
  features?: string[];
  createdAt?: number;
}

export interface PaymentNumber {
  number: string;
  label?: string;
  type?: string;
  instruction?: string;
  isActive: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface PaymentMethodEntry {
  numbers: Record<string, PaymentNumber>;
}

export type PaymentMethods = Record<"upi" | "bkash" | "usdt", PaymentMethodEntry>;

export interface KeyPackage {
  name: string;
  price: number;
  hours: number;
}

export interface SecurityCode {
  status: "active" | "used" | "banned" | "reset_required" | string;
  name?: string;
  hours?: number;
  package?: KeyPackage;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
  validity?: number;
  createdAt?: number;
  usedAt?: number;
  usedBy?: string;
  usedCount?: number;
  totalDevices?: number;
  deviceLogins?: Record<string, number>;
  lastLogin?: number;
  lastDeviceId?: string;
  resetAt?: number;
  resetRequestedAt?: number;
  resetRequestedBy?: string;
  bannedAt?: number;
}

export interface ActivityEntry {
  text?: string;
  time?: number;
}

export interface UserPackage {
  name?: string;
  price?: number;
  hours?: number;
  status?: string;
  startTime?: number;
  endTime?: number;
}

export interface UserRecord {
  username?: string;
  balance?: number;
  createdAt?: number;
  package?: UserPackage;
  usedKey?: string;
  deviceId?: string;
  lastLogin?: number;
  activity?: Record<string, ActivityEntry>;
}

export interface PackagePayment {
  id?: string;
  amount: number;
  packageName: string;
  hours: number;
  method: string;
  originalPrice?: number;
  discountPercent?: number;
  approvedAt?: number;
  createdAt: number;
  isGuest?: boolean;
}

export interface PaymentRequest {
  id?: string;
  amount: number;
  convertedAmount?: number;
  currency: string;
  method: string;
  createdAt: number;
  approvedAt?: number;
}

export interface TransferRequest {
  id?: string;
  amount: number;
  minAmount?: number;
  status?: string;
  username?: string;
  userId?: string;
  createdAt: number;
  connections?: {
    bettingLink?: string;
    username?: string;
  };
}

export interface ActivationCode {
  originalCode: string;
  active: boolean;
  used: boolean;
  usedAt?: number;
  usedBy?: string;
  usedFor?: string;
  createdAt?: number;
  createdBy?: string;
}

export interface AdminKey {
  originalKey: string;
  status: string;
  loginCount: number;
  maxLogins: number;
  createdAt?: number;
  lastLogin?: number;
  label?: string;
  createdBy?: string;
}

export interface NotificationItem {
  title: string;
  message?: string;
  type?: string;
  read?: boolean;
  timestamp: number;
}
