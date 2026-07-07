import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, AlertCircle, Loader2, Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCredentials } from '@/hooks/use-credentials'
import { useGroupOptions } from '@/hooks/use-groups'
import { GroupMultiSelect } from '@/components/group-select'
import {
  batchImportCredentials,
  getProxyPool,
  type BatchImportItemEvent,
  type BatchImportSummary,
} from '@/api/credentials'
import type { AddCredentialRequest } from '@/types/api'
import {
  completeExternalIdpImportFields,
  deriveEmailFromAccessToken,
  extractErrorMessage,
  maskProxyUrl,
  normalizeImportAuthMethod,
  sha256Hex,
} from '@/lib/utils'

interface BatchImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CredentialInput {
  refreshToken?: string
  refresh_token?: string
  accessToken?: string
  access_token?: string
  clientId?: string
  client_id?: string
  clientSecret?: string
  client_secret?: string
  region?: string
  authRegion?: string
  auth_region?: string
  apiRegion?: string
  api_region?: string
  priority?: number
  rpmLimit?: number
  rpm_limit?: number
  machineId?: string
  machine_id?: string
  kiroApiKey?: string
  kiro_api_key?: string
  authMethod?: string
  auth_method?: string
  provider?: string
  idp?: string
  tokenEndpoint?: string
  token_endpoint?: string
  issuerUrl?: string
  issuer_url?: string
  scopes?: string
  endpoint?: string
  email?: string
  proxyUrl?: string
  proxy_url?: string
  proxyUsername?: string
  proxy_username?: string
  proxyPassword?: string
  proxy_password?: string
  profileArn?: string
  profile_arn?: string
  expiresAt?: string
  expires_at?: string
  expired?: string
  userId?: string | null
  user_id?: string | null
  startUrl?: string
  start_url?: string
  status?: string
  groups?: string[]
}

interface VerificationResult {
  index: number
  status: 'pending' | 'checking' | 'verifying' | 'verified' | 'imported' | 'duplicate' | 'failed' | 'skipped'
  error?: string
  usage?: string
  email?: string
  credentialId?: number
  rollbackStatus?: 'success' | 'failed' | 'skipped'
  rollbackError?: string
}

function preferString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function preferNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function preferStringArray(obj: Record<string, unknown>, ...keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  }
  return undefined
}

function normalizeExpiresAt(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  return undefined
}

function parseImportEntries(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('无法识别的 JSON 格式')
  }
  const obj = parsed as Record<string, unknown>
  if (Array.isArray(obj.accounts)) return obj.accounts
  if (
    (obj.credentials && typeof obj.credentials === 'object') ||
    typeof obj.refreshToken === 'string' ||
    typeof obj.refresh_token === 'string' ||
    typeof obj.kiroApiKey === 'string' ||
    typeof obj.kiro_api_key === 'string'
  ) {
    return [obj]
  }
  throw new Error('无法识别的导入格式：请粘贴凭据对象、数组，或 Kiro Account Manager 导出的 accounts JSON')
}

/**
 * 归一化单条导入条目，兼容两种格式：
 * 1. 扁平 `credentials.json` 格式（字段直接位于顶层）；
 * 2. 嵌套「Account / Kiro Account Manager」导出格式（账号字段在顶层，
 *    认证字段收进嵌套 `credentials` 对象，`idp` 即 provider）。
 * 嵌套对象里的字段优先级高于顶层同名字段。
 */
function normalizeImportEntry(raw: unknown): CredentialInput {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const nested =
    obj.credentials && typeof obj.credentials === 'object'
      ? (obj.credentials as Record<string, unknown>)
      : {}
  // 合并：顶层在前，嵌套 credentials 覆盖顶层
  const merged = { ...obj, ...nested } as Record<string, unknown>
  // provider 兼容 idp 别名
  if (merged.provider == null && obj.idp != null) {
    merged.provider = obj.idp
  }
  const accessToken = preferString(merged, 'accessToken', 'access_token')
  const normalized: CredentialInput = {
    refreshToken: preferString(merged, 'refreshToken', 'refresh_token'),
    accessToken,
    profileArn: preferString(merged, 'profileArn', 'profile_arn'),
    expiresAt: normalizeExpiresAt(merged.expiresAt ?? merged.expires_at ?? merged.expired),
    clientId: preferString(merged, 'clientId', 'client_id'),
    clientSecret: preferString(merged, 'clientSecret', 'client_secret'),
    region: preferString(merged, 'region'),
    authRegion: preferString(merged, 'authRegion', 'auth_region'),
    apiRegion: preferString(merged, 'apiRegion', 'api_region'),
    priority: preferNumber(merged, 'priority'),
    rpmLimit: preferNumber(merged, 'rpmLimit', 'rpm_limit'),
    machineId: preferString(merged, 'machineId', 'machine_id'),
    kiroApiKey: preferString(merged, 'kiroApiKey', 'kiro_api_key'),
    authMethod: preferString(merged, 'authMethod', 'auth_method'),
    provider: preferString(merged, 'provider'),
    idp: preferString(merged, 'idp'),
    tokenEndpoint: preferString(merged, 'tokenEndpoint', 'token_endpoint'),
    issuerUrl: preferString(merged, 'issuerUrl', 'issuer_url'),
    scopes: preferString(merged, 'scopes'),
    startUrl: preferString(merged, 'startUrl', 'start_url'),
    endpoint: preferString(merged, 'endpoint'),
    email: preferString(merged, 'email') || deriveEmailFromAccessToken(accessToken),
    status: preferString(merged, 'status'),
    proxyUrl: preferString(merged, 'proxyUrl', 'proxy_url'),
    proxyUsername: preferString(merged, 'proxyUsername', 'proxy_username'),
    proxyPassword: preferString(merged, 'proxyPassword', 'proxy_password'),
    groups: preferStringArray(merged, 'groups'),
    userId:
      typeof merged.userId === 'string' || merged.userId === null
        ? merged.userId
        : typeof merged.user_id === 'string' || merged.user_id === null
          ? merged.user_id
          : undefined,
  }
  const completed = completeExternalIdpImportFields(normalized)
  normalized.tokenEndpoint = completed.tokenEndpoint
  normalized.issuerUrl = completed.issuerUrl
  normalized.scopes = completed.scopes
  // 仅保留 CredentialInput 关心的字段（其余忽略），避免把 credentials 子对象本身传下去
  delete merged.credentials
  return normalized
}

/**
 * 合并「导入对话框选择的分组」与「JSON 条目自带的 groups」，去重并去空白。
 * 返回 undefined 表示不带 groups 字段（两边都为空时）。
 */
function mergeGroups(
  selected: string[],
  fromJson: string[] | undefined,
): string[] | undefined {
  const all = [
    ...selected,
    ...(Array.isArray(fromJson) ? fromJson : []),
  ]
    .map((g) => (typeof g === 'string' ? g.trim() : ''))
    .filter(Boolean)
  if (all.length === 0) return undefined
  return Array.from(new Set(all))
}

function isErrorStatus(status: string | undefined): boolean {
  return status?.trim().toLowerCase() === 'error'
}

function parseUniformRpmLimit(raw: string): number | undefined {
  const value = raw.trim()
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('统一 RPM 必须是大于等于 0 的整数')
  }
  return parsed
}

function maskProxyCandidate(candidate: string): string {
  return candidate.toLowerCase() === 'direct' ? 'direct' : maskProxyUrl(candidate)
}

export function BatchImportDialog({ open, onOpenChange }: BatchImportDialogProps) {
  const [jsonInput, setJsonInput] = useState('')
  const [importing, setImporting] = useState(false)
  const [skipErrorAccounts, setSkipErrorAccounts] = useState(true)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [currentProcessing, setCurrentProcessing] = useState<string>('')
  const [results, setResults] = useState<VerificationResult[]>([])
  // 导入时统一为所有账号设置的分组（与 JSON 内 groups 取并集）。
  const [groups, setGroups] = useState<string[]>([])
  // 统一覆盖导入账号的代理与 RPM；留空表示保留 JSON/现有自动分配逻辑。
  const [uniformProxyUrl, setUniformProxyUrl] = useState('')
  const [uniformRpmLimit, setUniformRpmLimit] = useState('')
  const groupOptions = useGroupOptions()
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 进行中的 AbortController，用于"停止导入"：abort 会让 fetch 流中断，
  // 服务端在下次写回事件时检测到接收端关闭即停止处理剩余凭据。
  const abortRef = useRef<AbortController | null>(null)

  const { data: existingCredentials } = useCredentials()
  const queryClient = useQueryClient()
  const { data: proxyPool } = useQuery({
    queryKey: ['proxy-pool'],
    queryFn: getProxyPool,
    enabled: open,
  })

  const resetForm = () => {
    setJsonInput('')
    setSkipErrorAccounts(true)
    setProgress({ current: 0, total: 0 })
    setCurrentProcessing('')
    setResults([])
    setGroups([])
    setUniformProxyUrl('')
    setUniformRpmLimit('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // 按原始下标局部更新单行结果（避免每条全量拷贝之外的额外复杂度）
  const updateResult = (i: number, patch: Partial<VerificationResult>) => {
    setResults(prev => {
      const next = [...prev]
      next[i] = { ...next[i], ...patch }
      return next
    })
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    try {
      const fileTexts = await Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() }))
      )
      const merged: unknown[] = []
      const failed: { name: string; reason: string }[] = []

      for (const { name, text } of fileTexts) {
        try {
          merged.push(...parseImportEntries(JSON.parse(text)))
        } catch (error) {
          failed.push({ name, reason: extractErrorMessage(error) })
        }
      }

      if (merged.length === 0) {
        toast.error(`所有文件均解析失败：${failed.map((f) => `${f.name}（${f.reason}）`).join('；')}`)
        return
      }

      setJsonInput(JSON.stringify({ version: 'merged', accounts: merged }, null, 2))
      setResults([])
      const summary = files.length === 1 ? files[0].name : `${files.length} 个文件`
      if (failed.length > 0) {
        toast.warning(`已加载 ${summary}，合并 ${merged.length} 条记录；${failed.length} 个文件解析失败`)
      } else {
        toast.success(`已加载 ${summary}，合并 ${merged.length} 条记录`)
      }
    } catch (error) {
      toast.error('读取文件失败: ' + extractErrorMessage(error))
    } finally {
      event.target.value = ''
    }
  }

  const handleBatchImport = async (verify: boolean) => {
    // 先单独解析 JSON，给出精准的错误提示
    let credentials: CredentialInput[]
    try {
      credentials = parseImportEntries(JSON.parse(jsonInput)).map(normalizeImportEntry)
    } catch (error) {
      toast.error('JSON 格式错误: ' + extractErrorMessage(error))
      return
    }

    if (credentials.length === 0) {
      toast.error('没有可导入的凭据')
      return
    }

    const proxyOverride = uniformProxyUrl.trim() || undefined
    let rpmOverride: number | undefined
    try {
      rpmOverride = parseUniformRpmLimit(uniformRpmLimit)
    } catch (error) {
      toast.error(extractErrorMessage(error))
      return
    }

    try {
      setImporting(true)
      setProgress({ current: 0, total: credentials.length })

      // 初始化结果
      const initialResults: VerificationResult[] = credentials.map((cred, i) => ({
        index: i + 1,
        status: skipErrorAccounts && isErrorStatus(cred.status) ? 'skipped' : 'pending',
        email: cred.email,
      }))
      setResults(initialResults)

      // 客户端去重：OAuth 与 API Key 分别使用对应的 hash 集合
      const existingOauthHashes = new Set(
        existingCredentials?.credentials
          .map(c => c.refreshTokenHash)
          .filter((hash): hash is string => Boolean(hash)) || []
      )
      const existingApiKeyHashes = new Set(
        existingCredentials?.credentials
          .map(c => c.apiKeyHash)
          .filter((hash): hash is string => Boolean(hash)) || []
      )

      // 可用的代理池条目（用于无代理凭据的随机分配）
      const enabledProxies = proxyPool?.proxies.filter(p => p.enabled) ?? []

      // 本地预处理：代理分配 + 去重 + 校验 + 构造请求。
      // 不通过的行直接标终态；通过的收集进 toImport，记录其原始下标，
      // 以便把服务端 SSE 事件（按 toImport 内位置返回 index）映射回对应行。
      const toImport: { index: number; req: AddCredentialRequest }[] = []

      for (let i = 0; i < credentials.length; i++) {
        const cred = credentials[i]

        if (skipErrorAccounts && isErrorStatus(cred.status)) {
          continue
        }

        // 统一代理优先级最高；否则沿用 JSON 内单条代理；都没有时保持现有随机分配代理池逻辑。
        if (proxyOverride) {
          cred.proxyUrl = proxyOverride
        } else if (!cred.proxyUrl?.trim() && enabledProxies.length > 0) {
          const picked = enabledProxies[Math.floor(Math.random() * enabledProxies.length)]
          cred.proxyUrl = picked.url
        }
        const rpmLimit = rpmOverride ?? cred.rpmLimit ?? 0
        const isApiKeyCred = !!(cred.kiroApiKey?.trim()) || cred.authMethod === 'api_key'

        updateResult(i, { status: 'checking' })

        if (isApiKeyCred) {
          const apiKey = cred.kiroApiKey?.trim() || ''
          if (!apiKey) {
            updateResult(i, { status: 'failed', error: '缺少 kiroApiKey' })
            continue
          }
          const credHash = await sha256Hex(apiKey)
          if (existingApiKeyHashes.has(credHash)) {
            const existingCred = existingCredentials?.credentials.find(c => c.apiKeyHash === credHash)
            updateResult(i, {
              status: 'duplicate',
              error: '该凭据已存在',
              email: existingCred?.email || undefined
            })
            continue
          }
          existingApiKeyHashes.add(credHash)
          toImport.push({
            index: i,
            req: {
              authMethod: 'api_key',
              kiroApiKey: apiKey,
              priority: cred.priority || 0,
              rpmLimit,
              authRegion: cred.authRegion?.trim() || cred.region?.trim() || undefined,
              apiRegion: cred.apiRegion?.trim() || undefined,
              machineId: cred.machineId?.trim() || undefined,
              endpoint: cred.endpoint?.trim() || undefined,
              email: cred.email?.trim() || undefined,
              proxyUrl: cred.proxyUrl?.trim() || undefined,
              proxyUsername: cred.proxyUsername?.trim() || undefined,
              proxyPassword: cred.proxyPassword?.trim() || undefined,
              groups: mergeGroups(groups, cred.groups),
            },
          })
        } else {
          const token = cred.refreshToken?.trim() || ''
          if (!token) {
            updateResult(i, { status: 'failed', error: '缺少 refreshToken' })
            continue
          }
          const credHash = await sha256Hex(token)
          if (existingOauthHashes.has(credHash)) {
            const existingCred = existingCredentials?.credentials.find(c => c.refreshTokenHash === credHash)
            updateResult(i, {
              status: 'duplicate',
              error: '该凭据已存在',
              email: existingCred?.email || undefined
            })
            continue
          }
          existingOauthHashes.add(credHash)

          const clientId = cred.clientId?.trim() || undefined
          const clientSecret = cred.clientSecret?.trim() || undefined
          const completed = completeExternalIdpImportFields({
            ...cred,
            clientId,
          })
          const tokenEndpoint = completed.tokenEndpoint
          const issuerUrl = completed.issuerUrl
          const scopes = completed.scopes

          const { authMethod, error: authError } = normalizeImportAuthMethod(cred.authMethod, {
            tokenEndpoint,
            issuerUrl,
            scopes,
            userId: cred.userId,
            accessToken: cred.accessToken,
            clientId,
            clientSecret,
            provider: cred.provider,
            idp: cred.idp,
          })
          if (authError) {
            updateResult(i, { status: 'failed', error: authError })
            continue
          }

          const isExternalIdp = authMethod === 'external_idp'
          toImport.push({
            index: i,
            req: {
              refreshToken: token,
              accessToken: cred.accessToken?.trim() || undefined,
              profileArn: cred.profileArn?.trim() || undefined,
              expiresAt: cred.expiresAt?.trim() || undefined,
              authMethod,
              provider:
                cred.provider?.trim() ||
                cred.idp?.trim() ||
                (isExternalIdp ? 'AzureAD' : undefined),
              authRegion: cred.authRegion?.trim() || cred.region?.trim() || undefined,
              apiRegion: cred.apiRegion?.trim() || undefined,
              startUrl: cred.startUrl?.trim() || undefined,
              clientId,
              // external_idp 为公共客户端，不携带 clientSecret
              clientSecret: isExternalIdp ? undefined : clientSecret,
              tokenEndpoint: isExternalIdp ? tokenEndpoint : undefined,
              issuerUrl: isExternalIdp ? issuerUrl : undefined,
              scopes: isExternalIdp ? scopes : undefined,
              priority: cred.priority || 0,
              rpmLimit,
              machineId: cred.machineId?.trim() || undefined,
              endpoint: cred.endpoint?.trim() || undefined,
              email: cred.email?.trim() || undefined,
              proxyUrl: cred.proxyUrl?.trim() || undefined,
              proxyUsername: cred.proxyUsername?.trim() || undefined,
              proxyPassword: cred.proxyPassword?.trim() || undefined,
              groups: mergeGroups(groups, cred.groups),
            },
          })
        }
      }

      // 待上传的行标记为验活中
      for (const item of toImport) {
        updateResult(item.index, { status: 'verifying' })
      }

      if (toImport.length === 0) {
        setCurrentProcessing('没有需要上传的凭据（全部跳过、重复或校验失败）')
      } else {
        setCurrentProcessing(
          `${verify ? '批量验活' : '直接导入'}中（${toImport.length} 个）…`,
        )
        // 一次性 POST，服务端有界并发处理，逐条通过 SSE 回传结果。
        // 事件 ev.index 是 toImport 内的位置，需映射回原始凭据下标。
        const controller = new AbortController()
        abortRef.current = controller
        await batchImportCredentials(
          {
            credentials: toImport.map(t => t.req),
            proxyUrl: proxyOverride,
            rpmLimit: rpmOverride,
            concurrency: 8,
            verify,
          },
          (ev: BatchImportItemEvent) => {
            const orig = toImport[ev.index]?.index ?? -1
            if (orig < 0) return
            if (ev.status === 'verified') {
              updateResult(orig, {
                status: 'verified',
                usage: ev.usage,
                email: ev.email,
                credentialId: ev.credentialId,
              })
              setCurrentProcessing(ev.email ? `验活成功: ${ev.email}` : '验活成功')
            } else if (ev.status === 'imported') {
              updateResult(orig, {
                status: 'imported',
                email: ev.email,
                credentialId: ev.credentialId,
              })
              setCurrentProcessing(ev.email ? `已导入: ${ev.email}` : '已导入')
            } else if (ev.status === 'duplicate') {
              updateResult(orig, { status: 'duplicate', error: ev.error || '该凭据已存在' })
            } else {
              updateResult(orig, {
                status: 'failed',
                error: ev.error,
                rollbackStatus: ev.rolledBack ? 'success' : undefined,
              })
            }
          },
          (s: BatchImportSummary) => {
            const importedTotal = s.imported + s.verified
            if (verify) {
              if (s.failed === 0 && s.duplicate === 0) {
                toast.success(`成功导入并验活 ${s.verified} 个凭据`)
              } else {
                toast.info(
                  `验活完成：成功 ${s.verified} 个，重复 ${s.duplicate} 个，失败 ${s.failed} 个（已排除 ${s.rolledBack}）`
                )
                if (s.rolledBack < s.failed) {
                  toast.warning(`有 ${s.failed - s.rolledBack} 个失败凭据回滚未完成，请手动处理`)
                }
              }
            } else {
              if (s.failed === 0 && s.duplicate === 0) {
                toast.success(`直接导入 ${importedTotal} 个凭据（未验活）`)
              } else {
                toast.info(
                  `导入完成：成功 ${importedTotal} 个，重复 ${s.duplicate} 个，失败 ${s.failed} 个`
                )
              }
            }
          },
          controller.signal,
        )
      }

      // 刷新凭据列表，让新导入的立即可见
      await queryClient.invalidateQueries({ queryKey: ['credentials'] })
    } catch (error) {
      // 用户点击"停止"→ AbortError，服务端会停止处理剩余凭据；已完成的保留。
      if (error instanceof DOMException && error.name === 'AbortError') {
        toast.info('已停止导入（已完成的凭据保留）')
        await queryClient.invalidateQueries({ queryKey: ['credentials'] })
      } else {
        toast.error('导入失败: ' + extractErrorMessage(error))
      }
    } finally {
      abortRef.current = null
      setImporting(false)
    }
  }

  const getStatusIcon = (status: VerificationResult['status']) => {
    switch (status) {
      case 'pending':
        return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
      case 'checking':
      case 'verifying':
        return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      case 'verified':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />
      case 'imported':
        return <CheckCircle2 className="w-5 h-5 text-sky-500" />
      case 'duplicate':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />
      case 'skipped':
        return <AlertCircle className="w-5 h-5 text-gray-400" />
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />
    }
  }

  const getStatusText = (result: VerificationResult) => {
    switch (result.status) {
      case 'pending':
        return '等待中'
      case 'checking':
        return '检查重复...'
      case 'verifying':
        return '处理中...'
      case 'verified':
        return '验活成功'
      case 'imported':
        return '已导入（未验活）'
      case 'duplicate':
        return '重复凭据'
      case 'skipped':
        return '已跳过（error 状态）'
      case 'failed':
        if (result.rollbackStatus === 'success') return '验活失败（已排除）'
        if (result.rollbackStatus === 'failed') return '验活失败（未排除）'
        return '处理失败（未创建）'
    }
  }

  // 已终结（verified/imported/duplicate/failed）的行数，驱动进度条；客户端去重/校验在
  // 上传前即完成，故这些行在 SSE 流开始前就已计入。
  const finalizedCount = results.filter(
    r =>
      r.status === 'verified' ||
      r.status === 'imported' ||
      r.status === 'duplicate' ||
      r.status === 'failed' ||
      r.status === 'skipped'
  ).length

  const { previewCredentials, parseError } = useMemo(() => {
    if (!jsonInput.trim()) return { previewCredentials: [] as CredentialInput[], parseError: '' }
    try {
      return {
        previewCredentials: parseImportEntries(JSON.parse(jsonInput)).map(normalizeImportEntry),
        parseError: '',
      }
    } catch (error) {
      return { previewCredentials: [] as CredentialInput[], parseError: extractErrorMessage(error) }
    }
  }, [jsonInput])
  const errorAccountCount = previewCredentials.filter((cred) => isErrorStatus(cred.status)).length
  const enabledProxyOptions = proxyPool?.proxies.filter((proxy) => proxy.enabled) ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) {
          if (importing) {
            // 导入过程中关闭 = 停止导入（abort 服务端流）
            abortRef.current?.abort()
          } else {
            resetForm()
          }
        }
        onOpenChange(newOpen)
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>导入凭据</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium">
                JSON 凭据 / Kiro Account Manager 导出
              </label>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  <Upload className="w-4 h-4 mr-1.5" />
                  选择文件
                </Button>
              </div>
            </div>
            <textarea
              placeholder={'粘贴 JSON（支持单个对象、数组，或 Kiro Account Manager 导出的 { "version": "...", "accounts": [...] }）\n\nOAuth: [{"refreshToken":"...","clientId":"...","clientSecret":"..."}]\nAPI Key: [{"kiroApiKey":"ksk_xxx"}]\n企业 SSO: [{"authMethod":"external_idp","refreshToken":"...","clientId":"...","tokenEndpoint":"https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token","scopes":"...","region":"eu-central-1"}]\nKAM: {"version":"1.8.3","accounts":[{"email":"...","credentials":{"refreshToken":"...","clientId":"..."}}]}\n\n支持 region 自动映射为 authRegion，也支持多个 JSON 文件合并导入'}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              disabled={importing}
              className="flex min-h-[200px] w-full rounded-xl border border-input bg-background/60 px-3.5 py-2.5 text-sm transition-[border-color,background-color,box-shadow] duration-150 ease-apple placeholder:text-muted-foreground/70 hover:border-border focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 focus-visible:bg-background disabled:cursor-not-allowed disabled:opacity-50 font-mono"
            />
            <p className="text-xs text-muted-foreground">
              💡 "开始导入并验活"会校验余额、失败自动排除；"直接导入"只落库不验活（更快）。两种模式均支持中途"停止"。
            </p>
          </div>

          {parseError && (
            <div className="text-sm text-red-600 dark:text-red-400">解析失败: {parseError}</div>
          )}
          {previewCredentials.length > 0 && !importing && results.length === 0 && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="text-sm text-muted-foreground">
                识别到 {previewCredentials.length} 条记录
                {errorAccountCount > 0 && `（其中 ${errorAccountCount} 条为 error 状态）`}
              </div>
              {errorAccountCount > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={skipErrorAccounts}
                    onChange={(e) => setSkipErrorAccounts(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  跳过 error 状态的账号
                </label>
              )}
            </div>
          )}

          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="text-sm font-medium">统一导入设置（可选）</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">统一代理</label>
                <div className="grid gap-2">
                  <input
                    type="text"
                    value={uniformProxyUrl}
                    onChange={(e) => setUniformProxyUrl(e.target.value)}
                    disabled={importing}
                    placeholder="不填则保留 JSON/自动分配；direct 为直连"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return
                      setUniformProxyUrl(e.target.value)
                    }}
                    disabled={importing}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="">从代理池选择...</option>
                    <option value="direct">direct（直连）</option>
                    {enabledProxyOptions.map((proxy) => (
                      <option key={proxy.id} value={proxy.url}>
                        {proxy.label ? `${proxy.label} | ` : ''}{maskProxyCandidate(proxy.url)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">
                  填写后会覆盖所有导入账号的代理；留空则保留账号自带代理，没有代理字段时继续随机分配代理池。
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">统一 RPM</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={uniformRpmLimit}
                  onChange={(e) => setUniformRpmLimit(e.target.value)}
                  disabled={importing}
                  placeholder="不填则尊重 JSON；0 表示不限速"
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  填写后会覆盖所有导入账号的 rpmLimit；留空时 JSON 内有值就使用该值，否则默认 0。
                </p>
              </div>
            </div>
          </div>

          {/* 导入分组：选中的分组会统一应用到本次导入的所有账号
              （与 JSON 内自带的 groups 取并集），免去导入后逐个改分组。 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">分组（可选）</label>
            <GroupMultiSelect
              value={groups}
              options={groupOptions}
              onChange={setGroups}
              disabled={importing}
            />
            <p className="text-xs text-muted-foreground">
              为本次导入的所有账号统一指定分组，会和 JSON 内自带的 groups 合并去重。
            </p>
          </div>

          {(importing || results.length > 0) && (
            <>
              {/* 进度条 */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{importing ? '验活进度' : '验活完成'}</span>
                  <span>{finalizedCount} / {progress.total}</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${progress.total > 0 ? (finalizedCount / progress.total) * 100 : 0}%` }}
                  />
                </div>
                {importing && currentProcessing && (
                  <div className="text-xs text-muted-foreground">
                    {currentProcessing}
                  </div>
                )}
              </div>

              {/* 统计 */}
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 dark:text-green-400">
                  ✓ 验活成功: {results.filter(r => r.status === 'verified').length}
                </span>
                <span className="text-sky-600 dark:text-sky-400">
                  ✓ 已导入: {results.filter(r => r.status === 'imported').length}
                </span>
                <span className="text-yellow-600 dark:text-yellow-400">
                  ⚠ 重复: {results.filter(r => r.status === 'duplicate').length}
                </span>
                <span className="text-red-600 dark:text-red-400">
                  ✗ 失败: {results.filter(r => r.status === 'failed').length}
                </span>
                <span className="text-muted-foreground">
                  跳过: {results.filter(r => r.status === 'skipped').length}
                </span>
              </div>

              {/* 结果列表 */}
              <div className="border rounded-md divide-y max-h-[300px] overflow-y-auto">
                {results.map((result) => (
                  <div key={result.index} className="p-3">
                    <div className="flex items-start gap-3">
                      {getStatusIcon(result.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {result.email || `凭据 #${result.index}`}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {getStatusText(result)}
                          </span>
                        </div>
                        {result.usage && (
                          <div className="text-xs text-muted-foreground mt-1">
                            用量: {result.usage}
                          </div>
                        )}
                        {result.error && (
                          <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                            {result.error}
                          </div>
                        )}
                        {result.rollbackError && (
                          <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                            回滚失败: {result.rollbackError}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          {importing ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => abortRef.current?.abort()}
            >
              停止导入
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  resetForm()
                }}
              >
                {results.length > 0 ? '关闭' : '取消'}
              </Button>
              {results.length === 0 && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleBatchImport(false)}
                    disabled={!jsonInput.trim()}
                  >
                    直接导入（不验活）
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleBatchImport(true)}
                    disabled={!jsonInput.trim()}
                  >
                    开始导入并验活
                  </Button>
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
