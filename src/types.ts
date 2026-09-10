/** uuyc-cli JSON 输出的统一包装格式 */
export interface CliEnvelope<T> {
  data: T;
  success: boolean;
  timestamp: number;
}

export interface Device {
  deviceId: string;
  deviceName: string;
  isOnline: boolean;
  /** 新版 CLI 为数字(1/4 = Windows),旧版 CLI 为字符串("windows"/"mac"/...) */
  platform: number | string;
}

export interface DeviceListData {
  devices?: Device[];
}

export interface ConnectedDevice {
  targetId: string;
  targetName: string;
}

export interface DeviceStatusData {
  connected_devices?: ConnectedDevice[];
  /** 旧版 CLI 使用 connections 字段(新版为 connected_devices) */
  connections?: Array<ConnectedDevice | { targetId?: string; targetName?: string; deviceId?: string; deviceName?: string; id?: string; name?: string }>;
}

export interface CloudPC {
  cloudPCId: string;
  name: string;
  pcType: number;
  status: string;
}

export interface CloudPcListData {
  cloudPCs?: CloudPC[];
}

export interface UserInfo {
  userId: string;
  username: string;
  nickname: string;
  isVip: boolean;
}

export interface WalletData {
  coinBalance: number;
}

/** `lterm ls` 表格解析结果 */
export interface LtermSession {
  name: string;
  shell: string;
  state: string;
  createdAtMs: number | undefined;
  raw: string;
}

/** 远程终端会话(`term --list-sessions`,实测为 TSV 表格:SESSION_ID\tNAME\tSHELL\tSTATE\tLAST_ACTIVE) */
export interface TermSessionInfo {
  id: string;
  label: string;
  shell?: string;
  state?: string;
  lastActiveMs?: number;
  raw: string;
}

export type ShellKind = 'powershell' | 'cmd' | 'zsh' | 'bash';
