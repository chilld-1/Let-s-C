/**
 * 信令服务器冒烟测试（对应 TODOLIST T1.2）
 * 覆盖：创建房间 → 观众加入 → 密码校验 → 双向 signal 转发 → 成员广播 → 离开/销毁 → 异常输入
 * 运行：node server/test/smoke.mjs （需先启动服务器 node server/src/index.js）
 */
import { WebSocket } from 'ws'

const URL = process.env.SIGNAL_URL || 'ws://localhost:8787'
let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`)
  }
}

/** 简易客户端：按事件类型等待/订阅 */
function makeClient(name) {
  const ws = new WebSocket(URL)
  const waiters = new Map() // type -> [{resolve, filter}]
  const listeners = new Map() // type -> [fn]
  const inbox = []
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw))
    // 优先派发给正在等待的 waiter（消费式：消息不进入 inbox）
    let consumed = false
    const wsList = waiters.get(msg.type)
    if (wsList) {
      for (let i = wsList.length - 1; i >= 0; i--) {
        const w = wsList[i]
        if (!w.filter || w.filter(msg)) {
          wsList.splice(i, 1)
          w.resolve(msg)
          consumed = true
          break
        }
      }
    }
    if (!consumed) inbox.push(msg)
    ;(listeners.get(msg.type) || []).forEach((fn) => fn(msg))
  })
  return {
    ws,
    name,
    send: (obj) => ws.send(JSON.stringify(obj)),
    wait: (type, filter, timeoutMs = 3000) =>
      new Promise((resolve, reject) => {
        // 消费式等待：匹配到 inbox 中的消息即移除，避免重复匹配旧消息
        const idx = inbox.findIndex((m) => m.type === type && (!filter || filter(m)))
        if (idx >= 0) {
          const [m] = inbox.splice(idx, 1)
          return resolve(m)
        }
        const timer = setTimeout(() => reject(new Error(`${name} 等待 ${type} 超时`)), timeoutMs)
        const entry = {
          resolve: (m) => {
            clearTimeout(timer)
            resolve(m)
          },
          filter
        }
        if (!waiters.has(type)) waiters.set(type, [])
        waiters.get(type).push(entry)
      }),
    on: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    close: () => ws.close()
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const genId = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)

async function main() {
  const idA = genId().slice(0, 16)
  const idB = genId().slice(0, 16)

  console.log('— 1. 创建房间（带密码） —')
  const host = makeClient('host')
  await new Promise((r) => host.ws.on('open', r))
  host.send({ type: 'create-room', clientId: idA, name: '房主小明', password: '1234' })
  const created = await host.wait('room-created')
  ok(typeof created.roomId === 'string' && /^[A-Z2-9]{6}$/.test(created.roomId), `房间创建成功，房间码 ${created.roomId}`)
  ok(created.role === 'host', '角色为 host')
  const roomId = created.roomId

  console.log('— 2. 观众加入（密码错误 → 拒绝） —')
  const guest = makeClient('guest')
  await new Promise((r) => guest.ws.on('open', r))
  guest.send({ type: 'join-room', roomId, password: 'wrong', clientId: idB, name: '小红' })
  const pwdErr = await guest.wait('error')
  ok(pwdErr.message.includes('密码'), `错误密码被拒绝：${pwdErr.message}`)

  console.log('— 3. 观众加入（密码正确 → 成功 + 广播 + 通知房主） —')
  const peerJoinedP = host.wait('peer-joined')
  const membersP = host.wait('members')
  guest.send({ type: 'join-room', roomId, password: '1234', clientId: idB, name: '小红' })
  const joined = await guest.wait('room-joined')
  ok(joined.role === 'guest' && joined.hostId === idA, '观众加入成功，拿到 hostId')
  const peerJoined = await peerJoinedP
  ok(peerJoined.peerId === idB, `房主收到 peer-joined：${peerJoined.peerName}`)
  const membersMsg = await membersP
  ok(membersMsg.members.length === 2, '成员列表广播为 2 人')

  console.log('— 4. 双向 signal 转发（SDP/ICE 模拟） —')
  const hostGotSignal = host.wait('signal', (m) => m.from === idB)
  guest.send({ type: 'signal', to: idA, data: { ice: { candidate: 'candidate:0 1 UDP 1 127.0.0.1 5000 typ host' } } })
  const sig1 = await hostGotSignal
  ok(sig1.data.ice, '观众 → 房主 ICE 转发成功')
  const guestGotSignal = guest.wait('signal', (m) => m.from === idA)
  host.send({ type: 'signal', to: idB, data: { sdp: { type: 'offer', sdp: 'v=0' } } })
  const sig2 = await guestGotSignal
  ok(sig2.data.sdp?.type === 'offer', '房主 → 观众 SDP 转发成功')

  console.log('— 5. 非法 signal（发给房间外成员 → 丢弃） —')
  let gotErr = false
  guest.on('error', () => (gotErr = true))
  host.send({ type: 'signal', to: '0000000000000000', data: { ice: {} } })
  await sleep(300)
  ok(!gotErr, '发给不存在成员的 signal 被静默丢弃')

  console.log('— 6. 加入不存在房间 → 明确错误 —')
  guest.send({ type: 'join-room', roomId: 'ZZZZZZ', password: '', clientId: genId(), name: '路人' })
  const notFound = await guest.wait('error', (m) => m.message.includes('房间不存在'))
  ok(true, `提示：${notFound.message}`)

  console.log('— 7. 观众离开 → 房主收到 peer-left —')
  const leftP = host.wait('peer-left')
  guest.send({ type: 'leave-room' })
  const left = await leftP
  ok(left.peerId === idB, '房主收到 peer-left')

  console.log('— 8. 房主离开 → 房间销毁 —')
  const hostLeftP = new Promise((resolve) => {
    const g2 = makeClient('g2')
    g2.ws.on('open', () => {
      g2.send({ type: 'join-room', roomId, password: '1234', clientId: genId().slice(0, 16), name: '路人乙' })
      g2.on('host-left', (m) => resolve(m))
    })
  })
  await sleep(200)
  host.send({ type: 'leave-room' })
  const hostLeft = await hostLeftP
  ok(hostLeft.message.includes('房主已离开'), '观众收到 host-left 通知')

  console.log('— 9. 异常输入（坏 JSON / 未知 type）不崩溃 —')
  const bad = makeClient('bad')
  await new Promise((r) => bad.ws.on('open', r))
  bad.ws.send('not json{{{')
  const badJson = await bad.wait('error')
  ok(badJson.message.includes('JSON'), `坏 JSON 返回错误：${badJson.message}`)
  bad.send({ type: 'no-such-type' })
  const unknown = await bad.wait('error')
  ok(unknown.message.includes('未知'), `未知 type 返回错误：${unknown.message}`)

  host.close()
  guest.close()
  bad.close()
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('测试失败：', err.message)
  process.exit(1)
})
