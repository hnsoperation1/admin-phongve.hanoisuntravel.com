import { Zalo, ThreadType, type Credentials, type API } from 'zca-js'

// zca-js là client Zalo cá nhân (không phải API chính thức) — mỗi lần
// route API/cron chạy là 1 process serverless mới, không giữ được state
// giữa các lần gọi. Vì vậy KHÔNG dùng loginQR() (cần tương tác quét mã),
// mà login lại bằng session đã lưu 1 lần trước đó (Credentials: imei,
// cookie, userAgent) — lưu trong env ZALO_SESSION_CREDENTIALS.
let apiPromise: Promise<API> | null = null

function getCredentials(): Credentials {
  const raw = process.env.ZALO_SESSION_CREDENTIALS
  if (!raw) throw new Error('Thiếu env ZALO_SESSION_CREDENTIALS')
  return JSON.parse(raw) as Credentials
}

async function getApi(): Promise<API> {
  if (!apiPromise) {
    const zalo = new Zalo()
    apiPromise = zalo.login(getCredentials()).catch((err) => {
      apiPromise = null // cho phép thử lại ở lần gọi sau nếu login lỗi
      throw err
    })
  }
  return apiPromise
}

export async function sendZaloGroupMessage(groupId: string, message: string): Promise<void> {
  const api = await getApi()
  await api.sendMessage(message, groupId, ThreadType.Group)
}
