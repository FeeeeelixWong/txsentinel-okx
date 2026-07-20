<p align="right"><a href="README.md">English</a> · <strong>简体中文</strong></p>

# 🛡️ TxSentinel

> 面向自主智能体的确定性交易策略防火墙。

在智能体签署链上操作之前，TxSentinel 会评估操作意图、策略限制和外部提供的模拟证据，
并生成可解释的 `ALLOW`、`HOLD` 或 `DENY` 决策凭证。TxSentinel 不托管资产、不签署交易，
也不负责广播交易。

## 🔗 快速入口

| 功能 | 链接 | 用途 |
| --- | --- | --- |
| 🚀 在线产品 | [打开 TxSentinel](https://txsentinel-okx.vercel.app) | 查看产品概览和引导式工作流 |
| 🧪 策略评估器 | [评估链上操作](https://txsentinel-okx.vercel.app/evaluate.html) | 测试 `ALLOW`、`HOLD` 和 `DENY` 决策 |
| ⛓️ 链上控制台 | [在 X Layer 上验证](https://txsentinel-okx.vercel.app/onchain.html) | 注册策略并锚定决策凭证 |
| 🔌 集成指南 | [接入智能体](https://txsentinel-okx.vercel.app/integrate.html) | 接入智能体或钱包工作流 |
| 📡 免费审核 API | [`POST /api/check`](https://txsentinel-okx.vercel.app/api/check) | 确定性的公开策略评估接口 |

**项目状态：** ASP 候选服务 `TxSentinel #6828` · 已提交上架审核<br>
**参赛项目：** OKX.AI Genesis Hackathon

## 📚 项目文档

- [可视化产品指南](docs/VISUAL_GUIDE.md)
- [架构与信任边界](ARCHITECTURE.md)
- [API 协议](docs/API.md)
- [策略常见问题](#policy-faq-zh)

## 🗺️ 一张图看懂产品

![TxSentinel 产品流程](docs/assets/product-overview.svg)

1. 智能体构造一笔链上操作。
2. TxSentinel 在操作被签名之前执行策略检查。
3. 策略引擎返回 `ALLOW`、`HOLD` 或 `DENY`，并生成确定性证据。
4. 钱包可以将凭证锚定到 X Layer，同时不向合约授予资产托管权或交易执行权。

## ⛓️ 哪些内容会上链？

![TxSentinel 链上交互流程](docs/assets/onchain-sequence.svg)

`registerPolicy` 不会授权代币，也不会转移资产。它只会把钱包地址与策略哈希和版本绑定。
`anchorReceipt` 只保存决策证据，不会执行被评估的链上操作。

## 🎯 为什么需要 TxSentinel？

智能体钱包让自动执行链上操作成为可能，但缺少签名前策略边界的自动化是不安全的。
大多数交易模拟器回答的是一笔交易“能否执行”，TxSentinel 回答的是智能体在特定授权范围内
“是否应该执行”这笔交易。

每一份决策结果都包含：

- 标准化后的操作和不可变的策略快照
- 结构化规则证据和确定性风险分数
- 操作摘要和 SHA-256 凭证哈希
- 不包含私钥、签名权限或交易广播能力

## ⚡ 快速体验

```bash
curl -sS https://txsentinel-okx.vercel.app/api/check \
  -H 'Content-Type: application/json' \
  -d '{
    "chain":"xlayer",
    "operation":"transfer",
    "to":"0x4a6aae28b27681856ae824af82fea87896ecc3ed",
    "amountUsd":25,
    "policy":{"maxSpendUsd":100,"requireSimulation":true},
    "simulation":{"status":"succeeded","estimatedFeeUsd":0.01}
  }'
```

该接口也接受空的 POST 请求，并返回一个有文档说明的审核示例，方便市场审核人员直接验证服务可用性。

## 🚦 决策模型

| 决策 | 含义 | 典型规则 |
| --- | --- | --- |
| `ALLOW` | 所有约束均通过 | 转账金额和手续费均在限制范围内 |
| `HOLD` | 需要人工确认或补充上游证据 | 金额上限、白名单、模拟、合约、滑点、手续费 |
| `DENY` | 操作违反硬性安全边界 | 不支持的网络、黑名单地址、执行回滚、无限授权 |

当前支持 X Layer、Ethereum、Base 和 Solana；支持转账、兑换、代币授权和合约调用。

## 👤 策略归属

| 层级 | 控制方 | 示例 |
| --- | --- | --- |
| 用户策略 | 策略所有者 | 支出上限、地址名单、模拟要求、滑点和手续费限制 |
| 系统安全边界 | TxSentinel | 严格数据结构、支持的操作、非负数检查、确定性标准化 |
| 链上快照 | X Layer 合约 | 所有者、策略哈希、版本、修订号、启用状态和凭证 |

当前链上演示会注册经过审核的标准 Policy v1。更新策略时修订号会递增，已经按旧版本锚定的
凭证不会被后续更新改变。

## 🔌 OKX 集成

TxSentinel 将免费审核和付费服务隔离为两个独立入口：

1. `POST /api/check` 是稳定开放的免费 ASP 审核接口。
2. `POST /api/check-paid` 使用官方 `@okxweb3/x402-express`、`@okxweb3/x402-core` 和
   `@okxweb3/x402-evm`。只有配置 facilitator 凭证和收款地址后才会启用收费。

启用后，未付款请求会收到 HTTP `402` 和 `PAYMENT-REQUIRED`。OKX Agentic Wallet 完成签名后，
携带 `PAYMENT-SIGNATURE` 重试请求；结算完成后，服务返回策略结果和 `PAYMENT-RESPONSE`。

完整信任边界见 [ARCHITECTURE.md](ARCHITECTURE.md)，请求格式见 [docs/API.md](docs/API.md)。

## 🧑‍💻 本地开发

```bash
npm install
npm test
npm run check
npx vercel@53.4.0 dev --listen 8791
npm run smoke
```

测试覆盖策略边界、标准化、凭证确定性、异常输入和 HTTP 行为。Smoke 测试会对运行中的部署
执行三种决策，并检查 x402 服务状态。

## 💳 启用官方 x402

```bash
cp .env.example .env.local
# 填写 OKX_API_KEY、OKX_SECRET_KEY、OKX_PASSPHRASE 和 PAY_TO_ADDRESS
npx vercel@53.4.0 env add OKX_API_KEY production
npx vercel@53.4.0 env add OKX_SECRET_KEY production
npx vercel@53.4.0 env add OKX_PASSPHRASE production
npx vercel@53.4.0 env add PAY_TO_ADDRESS production
```

默认网络为 X Layer 测试网（`eip155:1952`）。只有在测试网完成端到端结算验证后，
才应切换到 X Layer 主网（`eip155:196`）。

### 真实结算准备度

| 条件 | 状态 |
| --- | --- |
| 官方 OKX x402 中间件与 EVM 方案 | ✅ 已完成 |
| 公开付费接口 | ✅ 已部署至 [`/api/check-paid`](https://txsentinel-okx.vercel.app/api/check-paid) |
| X Layer 测试网配置（`eip155:1952`） | ✅ 已完成 |
| Vercel 中的 OKX Developer Portal API 凭证 | ⏳ 待配置 |
| `PAY_TO_ADDRESS` EVM 收款地址 | ⏳ 待配置 |
| 买方钱包中的 X Layer 测试网 USD₮0 | ⏳ 待准备 |
| 结算交易哈希与 `PAYMENT-RESPONSE` 证据 | ⏳ 最终验证 |

三个配置条件齐备后，重新部署服务，再用 Agentic Wallet 跑通
`402 → 签名 → 重试 → 结算` 即可。具体步骤参考
[OKX 官方卖方 SDK 指南](https://web3.okx.com/zh-hans/onchainos/dev-docs/payments/service-seller-sdk)。

## 🔗 X Layer 凭证锚定

可选合约 `TxSentinelPolicyAnchor` 用于存储不可变的策略版本快照和确定性凭证哈希。
打开 `/onchain.html`，连接 OKX Wallet 后可以验证标准 X Layer 测试网部署、注册 Policy v1、
执行实时策略评估并锚定凭证。合约不能持有或转移资产，也不会获得签名权限。

- X Layer 测试网标准合约：[`0x295975cbec1673061d11c223b35a8513d1ebb213`](https://www.okx.com/web3/explorer/xlayer-test/address/0x295975cbec1673061d11c223b35a8513d1ebb213)
- 部署交易：[`0x6604803f...741ae9`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x6604803fda9b0b298ed18ea1e3e9dfc4b58b05e0f2989652f64500e8aa741ae9)
- Runtime bytecode hash：`0xd81838ab32626c1956fe06fb9551718b0b40b16ad54079dba38612e811c3c763`

```bash
npm run contract:compile
npm run contract:lint
npm run contract:test
```

<a id="policy-faq-zh"></a>

## ❓ 策略常见问题

### 1. 一个钱包可以拥有多个 Policy 吗？

**可以。** Policy 按 `(owner address, policyKey)` 存储。同一个钱包可以使用不同的
`policyKey` 注册多个相互独立的 Policy。每个 Policy 都有自己的规则哈希、版本、修订号、
启用状态、代理权限和凭证历史。由于每个钱包的命名空间相互隔离，不同钱包也可以使用相同的
应用级 `policyKey`。

### 2. Policy 可以更新吗？

**可以。** Policy 所有者可以调用 `updatePolicy`，提交新的规则哈希和版本哈希。每次更新都会
增加修订号。更新一个已经停用的 Policy 不会自动重新启用它。

历史凭证不会因为 Policy 更新而改变。每份凭证都会保存决策发生时的策略哈希、版本哈希和
修订号，因此可以形成可审计的历史快照。

### 3. 谁可以更新或停用 Policy？

只有 Policy 所有者钱包可以更新规则、修改启用状态或管理代理地址。获得授权的代理地址只能为
对应 Policy 锚定凭证，不能修改 Policy 的规则或状态。

### 4. Policy 会自动过期吗？

**不会。** 当前合约没有自动过期时间字段。Policy 注册后会保持启用，直到所有者调用
`setPolicyActive(policyKey, false)`。之后也可以调用 `setPolicyActive(policyKey, true)` 重新启用。

### 5. Policy 可以删除，或者用同一个 key 重新注册吗？

**不可以。** 链上 Policy 记录不会被删除，已经存在的 `(owner, policyKey)` 也不能重复注册。
所有者可以更新现有 Policy、将其停用，或者使用新的 `policyKey` 注册另一个 Policy。
这样可以避免历史凭证失去对应的策略身份。

### 6. 当前网页控制台开放了所有这些能力吗？

**还没有。** 已部署合约支持多个 Policy、规则更新、启停控制和 Policy 级代理授权。
当前黑客松控制台只展示一个经过审核的标准 Policy v1，以便评委快速验证完整的注册和凭证流程。

## 🔒 安全边界

TxSentinel 是只读策略服务。它会拒绝未知字段、限制付费接口的请求体大小、从不接收私钥字段，
并且不能签名或广播交易。外部提交的模拟结果只会被标记为“证据”，不会被描述成 TxSentinel
自行执行的 RPC 模拟。

## 🗂️ 仓库结构

```text
api/check.js          免费确定性策略接口
api/check-paid.js     官方 OKX x402 付费接口
lib/policy.js         纯函数策略与凭证引擎
public/               产品概览、四步评估器、链上控制台和集成指南
contracts/            非托管 X Layer 策略凭证合约
scripts/smoke.mjs     部署 Smoke 测试
test/                 策略和 HTTP 合约测试
```

## ✅ 当前状态

- ✅ 在线策略产品和公开 API：已完成
- ✅ ASP `#6828` 激活与上架审核：已提交
- ✅ 官方 x402 服务端集成：已实现
- ⏳ 真实 x402 结算：配置 facilitator 凭证、`PAY_TO_ADDRESS` 和测试网 USD₮0 后即可启动
