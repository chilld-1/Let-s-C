/** 持久化 clientId：用于断线重连时恢复房间身份（信令服务器按它恢复成员） */
const CLIENT_ID_KEY = 'lets-c-client-id'

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY)
  if (!id || !/^[0-9a-f]{16}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    localStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}

export function getDefaultName(): string {
  const saved = localStorage.getItem('lets-c-name')
  if (saved) return saved
  const name = `观众-${getClientId().slice(0, 4)}`
  return name
}

export function saveName(name: string): void {
  localStorage.setItem('lets-c-name', name)
}

export function getServerUrl(): string {
  return localStorage.getItem('lets-c-server-url') || 'ws://localhost:8787'
}

export function saveServerUrl(url: string): void {
  localStorage.setItem('lets-c-server-url', url)
}
