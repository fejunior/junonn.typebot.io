# SRS — Clone do Typebot com .NET (Clean Architecture) + Nuxt 4

## 1. Introdução

### 1.1 Objetivo
Este documento especifica os requisitos funcionais, não funcionais, arquitetura-alvo, domínio, contratos e fluxos para construir um clone do projeto Typebot usando:
- **Backend**: .NET 8+ com **Clean Architecture**.
- **Frontend**: **Nuxt 4** (SSR/SPA híbrido).
- **Banco**: PostgreSQL (principal) + Redis (cache/sessões/eventos em tempo real).

### 1.2 Escopo
O produto permitirá:
1. Autenticação e gestão de usuários/workspaces.
2. Editor visual para construção de bots por blocos e fluxos.
3. Publicação e execução de bots para usuários finais.
4. Coleta de respostas, analytics e exportação.
5. Integrações (Webhook/HTTP, email, IA, pagamentos, etc.).
6. Gestão de plano/assinatura e limites de uso.

### 1.3 Contexto do projeto analisado
A base original é um monorepo Turborepo/Bun com múltiplos apps e pacotes:
- Apps principais: `builder`, `viewer`, `landing-page`, `workflows`, `docs`.
- Pacotes por domínio: `auth`, `billing`, `blocks`, `bot-engine`, `chat-api`, `chat-session`, `results`, `typebot`, `workspaces`, `variables`, etc.
- Modelo de dados central inclui entidades como `User`, `Workspace`, `Typebot`, `Result`, `ChatSession`, `Answer`, `Webhook` e enums de plano/papel/colaboração.

## 2. Visão geral da solução alvo

### 2.1 Arquitetura macro
- **Nuxt 4 App**
  - Builder (editor visual)
  - Runtime Viewer (chat executável)
  - Admin (analytics, resultados, billing, configurações)
- **API Gateway (ASP.NET Core)**
  - REST + SSE/WebSocket para tempo real
  - versionamento `/api/v1`
- **Serviços de aplicação (Clean Architecture)**
  - Autenticação
  - Workspaces
  - Bot Management
  - Runtime Engine
  - Results & Analytics
  - Integrations
  - Billing
- **Infraestrutura**
  - PostgreSQL
  - Redis
  - Object Storage (S3 compatível)
  - Message Broker (RabbitMQ/Kafka opcional)
  - OpenTelemetry + Prometheus + Grafana

### 2.2 Clean Architecture (backend)
#### Camadas
1. **Domain**
   - Entidades, Value Objects, Enums, Domain Events, regras puras.
2. **Application**
   - Use Cases (Commands/Queries), DTOs, validações, portas (interfaces).
3. **Infrastructure**
   - EF Core, repositórios, serviços externos (Stripe/OpenAI/SMTP/Webhook).
4. **Presentation**
   - Controllers/Endpoints, Auth policies, serialização, rate limit.

#### Convenções
- MediatR ou CQRS nativo por feature.
- FluentValidation para requests.
- Result Pattern (`ErrorOr<T>`/`OneOf`) para erros de domínio.
- Outbox Pattern para eventos de integração.

## 3. Requisitos funcionais (RF)

### 3.1 Identidade e acesso
- **RF-001**: Registrar usuário por email/senha ou SSO (Google/GitHub).
- **RF-002**: Login, refresh token e logout global.
- **RF-003**: Recuperação de senha via token com expiração.
- **RF-004**: Multi-workspace por usuário.
- **RF-005**: Convite de membros por email com papel.
- **RF-006**: RBAC por workspace e por bot.

### 3.2 Workspaces
- **RF-010**: Criar/editar workspace.
- **RF-011**: Definir plano e limites de uso.
- **RF-012**: Domínio customizado para publicação.
- **RF-013**: Gestão de membros (owner/admin/member/billing).

### 3.3 Builder (editor)
- **RF-020**: Criar bot do zero ou por template.
- **RF-021**: Modelar bot via blocos conectados por arestas.
- **RF-022**: Versionamento de rascunho/publicado.
- **RF-023**: Pré-visualização em tempo real.
- **RF-024**: Tema visual configurável (cores, fontes, CSS custom).
- **RF-025**: Colaboração em bot com permissões.
- **RF-026**: Validação de fluxo antes de publicar.

### 3.4 Runtime (execução do chat)
- **RF-030**: Iniciar sessão de chat por bot publicado.
- **RF-031**: Navegar pelos blocos com regras condicionais.
- **RF-032**: Persistir respostas por sessão.
- **RF-033**: Suporte a anexos (arquivo/imagem).
- **RF-034**: Integrações em tempo de execução (HTTP, IA, pagamentos).
- **RF-035**: Encerrar sessão e registrar métricas de conclusão/drop-off.

### 3.5 Resultados e analytics
- **RF-040**: Listar resultados por bot/filtro temporal.
- **RF-041**: Exportar CSV/JSON.
- **RF-042**: Dashboard com taxa de início, conclusão e abandono.
- **RF-043**: Auditoria de eventos relevantes.

### 3.6 Integrações
- **RF-050**: Bloco de webhook (request síncrona/assíncrona).
- **RF-051**: Bloco de email transacional.
- **RF-052**: Bloco de IA (OpenAI/compatível).
- **RF-053**: Bloco de pagamento (Stripe).
- **RF-054**: Conectores pluggáveis por provider.

### 3.7 Billing
- **RF-060**: Assinatura por workspace.
- **RF-061**: Webhooks de pagamento para atualizar plano.
- **RF-062**: Aplicar limites por plano (bots, respostas, membros, integrações).

## 4. Requisitos não funcionais (RNF)

- **RNF-001 (Performance)**: P95 de endpoints críticos < 250ms (sem integrações externas).
- **RNF-002 (Escalabilidade)**: Runtime escalável horizontalmente (stateless + Redis).
- **RNF-003 (Disponibilidade)**: 99.9% mensal para API e viewer.
- **RNF-004 (Segurança)**: OWASP ASVS L2, criptografia em trânsito (TLS) e em repouso.
- **RNF-005 (Privacidade)**: suporte a LGPD/GDPR (consentimento, exclusão, exportação).
- **RNF-006 (Observabilidade)**: tracing distribuído + logs estruturados + métricas.
- **RNF-007 (Resiliência)**: retry com backoff + circuit breaker em integrações.
- **RNF-008 (Qualidade)**: cobertura mínima de testes backend 75% (domínio + aplicação).

## 5. Bounded Contexts e módulos

1. **Identity & Access**
2. **Workspace Management**
3. **Bot Authoring**
4. **Bot Runtime Engine**
5. **Results & Analytics**
6. **Integrations Hub**
7. **Billing & Quotas**
8. **Media & Assets**
9. **Audit & Observability**

## 6. Modelo de domínio (classes, enums, value objects)

> Abaixo está o modelo recomendado para o clone em .NET. Classes abstratas e interfaces foram incluídas para refletir Clean Architecture.

### 6.1 Base de domínio

#### Entidades base
- `Entity<TId>`
- `AggregateRoot<TId>`
- `AuditableEntity<TId>`
- `DomainEvent`

#### Value Objects base
- `Email`
- `Slug`
- `Money`
- `DateRange`
- `UrlValue`
- `PhoneNumber`

### 6.2 Identity & Access

#### Entidades
- `User`
- `UserAuthProvider`
- `RefreshToken`
- `VerificationToken`
- `ApiToken`
- `Session`

#### Value Objects
- `PasswordHash`
- `UserName`
- `Locale`
- `TimeZoneValue`

#### Enums
- `AuthProviderType { Local, Google, GitHub, Microsoft }`
- `UserStatus { Active, PendingVerification, Suspended, Deleted }`
- `TokenType { EmailVerification, PasswordReset, MagicLink, Api }`

### 6.3 Workspaces

#### Entidades
- `Workspace`
- `WorkspaceMember`
- `WorkspaceInvitation`
- `CustomDomain`
- `WorkspaceQuota`

#### Enums
- `WorkspaceRole { Owner, Admin, Member, Billing }`
- `WorkspacePlan { Free, Starter, Pro, Enterprise }`
- `InvitationStatus { Pending, Accepted, Expired, Revoked }`
- `DomainVerificationStatus { Pending, Verified, Failed }`

### 6.4 Bot Authoring

#### Entidades
- `Bot`
- `BotVersion`
- `BotCollaborator`
- `BotTheme`
- `BotVariable`
- `FlowGraph`
- `FlowNode`
- `FlowEdge`
- `Template`

#### Enums
- `BotStatus { Draft, Published, Archived }`
- `CollaborationType { Read, Edit, Admin }`
- `NodeType { Bubble, Input, Logic, Integration, System }`
- `GraphNavigationType { Continue, Jump, End }`

#### Blocos (classes concretas)
- `TextBubbleBlock`
- `ImageBubbleBlock`
- `VideoBubbleBlock`
- `AudioBubbleBlock`
- `EmbedBubbleBlock`
- `TextInputBlock`
- `EmailInputBlock`
- `PhoneInputBlock`
- `DateInputBlock`
- `ChoiceInputBlock`
- `FileInputBlock`
- `ConditionBlock`
- `ScriptBlock`
- `ABTestBlock`
- `WebhookBlock`
- `HttpRequestBlock`
- `OpenAiBlock`
- `StripePaymentBlock`
- `RedirectBlock`

#### Interfaces
- `IBlockDefinition`
- `IBlockExecutor`
- `IFlowValidator`
- `IBotVersioningService`

### 6.5 Runtime Engine

#### Entidades
- `ChatSession`
- `RuntimeState`
- `VisitedEdge`
- `Answer`
- `SetVariableHistoryItem`
- `RuntimeLog`
- `SessionParticipant`

#### Enums
- `SessionStatus { Created, Running, Completed, Abandoned, Failed }`
- `AnswerType { Text, Number, Boolean, Date, Choice, File, Json }`
- `ExecutionStatus { Pending, Success, Error, Timeout, Retried }`
- `ChatProvider { Web, WhatsApp, Api }`

#### Value Objects
- `SessionId`
- `CorrelationId`
- `IpAddressValue`
- `UserAgentValue`

### 6.6 Results & Analytics

#### Entidades
- `Result`
- `ResultMetric`
- `FunnelMetric`
- `DropOffMetric`
- `AnalyticsSnapshot`

#### Enums
- `MetricGranularity { Hour, Day, Week, Month }`
- `ExportFormat { Csv, Json, Parquet }`

### 6.7 Integrations Hub

#### Entidades
- `Credential`
- `CredentialSecret`
- `IntegrationConnection`
- `IntegrationEvent`
- `WebhookDelivery`

#### Enums
- `IntegrationProvider { Http, OpenAi, Stripe, Gmail, Sheets, Zapier, Make, Chatwoot }`
- `CredentialType { ApiKey, OAuth2, BasicAuth, BearerToken }`
- `WebhookStatus { Queued, Delivered, Failed, DeadLetter }`

#### Interfaces
- `IIntegrationProvider`
- `IWebhookDispatcher`
- `ICredentialVault`
- `IRetryPolicyFactory`

### 6.8 Billing & Quotas

#### Entidades
- `Subscription`
- `BillingCustomer`
- `Invoice`
- `Coupon`
- `ClaimableCustomPlan`
- `UsageCounter`

#### Enums
- `SubscriptionStatus { Trialing, Active, PastDue, Canceled, Unpaid }`
- `BillingCycle { Monthly, Yearly }`
- `QuotaType { Bots, Responses, Members, StorageGb, Integrations }`

### 6.9 Media & Assets

#### Entidades
- `MediaAsset`
- `RuntimeMediaCache`

#### Enums
- `MediaType { Image, Video, Audio, File }`
- `StorageProvider { S3, AzureBlob, Gcs, Local }`

## 7. Contratos de aplicação (Commands/Queries/DTOs)

### 7.1 Identity
#### Commands
- `RegisterUserCommand`
- `VerifyEmailCommand`
- `LoginCommand`
- `RefreshTokenCommand`
- `RequestPasswordResetCommand`
- `ResetPasswordCommand`

#### Queries
- `GetCurrentUserQuery`
- `ListUserWorkspacesQuery`

#### DTOs
- `UserDto`, `AuthTokenDto`, `SessionDto`

### 7.2 Workspaces
#### Commands
- `CreateWorkspaceCommand`
- `InviteWorkspaceMemberCommand`
- `AcceptWorkspaceInviteCommand`
- `UpdateWorkspacePlanCommand`
- `ConfigureCustomDomainCommand`

#### Queries
- `GetWorkspaceByIdQuery`
- `ListWorkspaceMembersQuery`
- `GetWorkspaceQuotaQuery`

### 7.3 Bot Authoring
#### Commands
- `CreateBotCommand`
- `DuplicateBotCommand`
- `UpdateBotGraphCommand`
- `UpdateBotThemeCommand`
- `PublishBotVersionCommand`
- `ArchiveBotCommand`

#### Queries
- `GetBotBuilderStateQuery`
- `ListBotsByWorkspaceQuery`
- `GetBotVersionDiffQuery`

### 7.4 Runtime
#### Commands
- `StartChatSessionCommand`
- `SubmitAnswerCommand`
- `AdvanceFlowCommand`
- `SetRuntimeVariableCommand`
- `CompleteSessionCommand`

#### Queries
- `GetRuntimeStateQuery`
- `GetNextPromptQuery`

### 7.5 Results
#### Queries
- `ListResultsQuery`
- `GetResultByIdQuery`
- `GetAnalyticsDashboardQuery`
- `ExportResultsQuery`

## 8. Especificação de API (REST v1)

### 8.1 Auth
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/password/reset-request`
- `POST /api/v1/auth/password/reset`

### 8.2 Workspaces
- `GET /api/v1/workspaces`
- `POST /api/v1/workspaces`
- `GET /api/v1/workspaces/{workspaceId}`
- `POST /api/v1/workspaces/{workspaceId}/invites`
- `POST /api/v1/workspaces/invites/{token}/accept`

### 8.3 Bots
- `GET /api/v1/workspaces/{workspaceId}/bots`
- `POST /api/v1/workspaces/{workspaceId}/bots`
- `GET /api/v1/bots/{botId}`
- `PUT /api/v1/bots/{botId}/graph`
- `PUT /api/v1/bots/{botId}/theme`
- `POST /api/v1/bots/{botId}/publish`

### 8.4 Runtime
- `POST /api/v1/runtime/bots/{publicSlug}/sessions`
- `POST /api/v1/runtime/sessions/{sessionId}/answers`
- `POST /api/v1/runtime/sessions/{sessionId}/advance`
- `GET /api/v1/runtime/sessions/{sessionId}`
- `POST /api/v1/runtime/sessions/{sessionId}/complete`

### 8.5 Results
- `GET /api/v1/bots/{botId}/results`
- `GET /api/v1/bots/{botId}/analytics`
- `POST /api/v1/bots/{botId}/results/export`

### 8.6 Webhooks
- `POST /api/v1/webhooks/stripe`
- `POST /api/v1/webhooks/integrations/{provider}`

## 9. Fluxos principais (E2E)

### 9.1 Fluxo A — Criação e publicação de bot
1. Usuário autenticado cria bot em um workspace.
2. Builder salva rascunho (`Bot`, `BotVersion`, `FlowGraph`).
3. Serviço de validação percorre grafo e regras de blocos.
4. Ao publicar, snapshot imutável de versão é criado.
5. `PublicBot`/slug é atualizado para runtime.

### 9.2 Fluxo B — Execução de sessão de chat
1. Visitor abre URL pública do bot.
2. Runtime cria `ChatSession` e inicializa estado.
3. Engine busca próximo nó (`FlowNode`) e renderiza prompt.
4. Visitor envia resposta; `Answer` é persistida.
5. Condições calculam próxima aresta.
6. Integrações são executadas quando necessário.
7. Sessão é finalizada com status e métricas.

### 9.3 Fluxo C — Exportação de resultados
1. Usuário seleciona filtros (bot/período).
2. Query monta dataset de `Result + Answer`.
3. Gera arquivo (CSV/JSON), armazena em object storage.
4. URL assinada é devolvida para download.

### 9.4 Fluxo D — Convite de membro
1. Admin envia convite por email.
2. Token é criado com expiração.
3. Convidado aceita e entra no workspace com papel definido.

## 10. Regras de negócio críticas

- **RB-001**: Apenas `Owner` e `Admin` podem convidar membros.
- **RB-002**: Apenas `Owner` altera plano de assinatura.
- **RB-003**: Publicação exige fluxo válido sem nós órfãos.
- **RB-004**: Sessão só pode iniciar em bot publicado e ativo.
- **RB-005**: Limites de plano bloqueiam criação/execução acima da cota.
- **RB-006**: Segredos de integração nunca retornam em APIs de leitura.
- **RB-007**: Dados pessoais devem ser anonimizáveis sob solicitação.

## 11. Modelo de dados relacional (sugestão)

### 11.1 Tabelas centrais
- `users`
- `sessions`
- `api_tokens`
- `workspaces`
- `workspace_members`
- `workspace_invitations`
- `custom_domains`
- `bots`
- `bot_versions`
- `bot_collaborators`
- `bot_themes`
- `flow_nodes`
- `flow_edges`
- `chat_sessions`
- `answers`
- `results`
- `visited_edges`
- `credentials`
- `webhook_deliveries`
- `subscriptions`
- `coupons`
- `usage_counters`
- `audit_logs`

### 11.2 Índices recomendados
- `chat_sessions(bot_id, created_at)`
- `answers(session_id, created_at)`
- `results(bot_id, completed_at)`
- `workspace_members(workspace_id, user_id)` único
- `bots(workspace_id, status)`

## 12. Frontend Nuxt 4 (arquitetura)

### 12.1 Módulos
- `apps/web/builder`
- `apps/web/viewer`
- `apps/web/admin`
- `apps/web/public`

### 12.2 Estrutura sugerida
- `pages/` rotas por domínio
- `components/` componentes visuais
- `features/` estado + lógica por feature
- `composables/` hooks (`useAuth`, `useWorkspace`, `useRuntime`)
- `server/api/` BFF opcional
- `plugins/` auth, telemetry, i18n
- `stores/` Pinia

### 12.3 Tipos frontend (TypeScript)
- `UserVm`, `WorkspaceVm`, `BotVm`, `FlowNodeVm`, `FlowEdgeVm`
- `RuntimePromptVm`, `RuntimeAnswerVm`, `ResultVm`, `AnalyticsVm`

### 12.4 Estado mínimo
- `authStore`
- `workspaceStore`
- `builderStore`
- `runtimeStore`
- `billingStore`

## 13. Segurança

- JWT curto + refresh token rotativo.
- CSRF protection para cookies autenticados.
- Rate limit por IP + fingerprint em endpoints runtime.
- Criptografia de segredos (KMS/Vault).
- Assinatura e validação de webhooks.
- Política de retenção e anonimização de dados.

## 14. Observabilidade e operação

- Correlation ID em toda request.
- OpenTelemetry (traces + metrics + logs).
- Dashboards:
  - Latência API
  - Erros por endpoint
  - Sessões iniciadas/concluídas
  - Taxa de falha por integração
- Alertas SLO (erro > 2% por 5 min, P95 > alvo).

## 15. Estratégia de testes

### 15.1 Backend
- Unit tests (Domain/Application).
- Integration tests com PostgreSQL em container.
- Contract tests para integrações externas.
- Smoke tests de endpoints críticos.

### 15.2 Frontend
- Unit tests (componentes/composables).
- E2E (Playwright) para fluxos:
  - Criar bot
  - Publicar bot
  - Executar chat
  - Exportar resultados

## 16. Roadmap de implementação (plano de ação)

### Fase 0 — Foundation (1–2 semanas)
- Bootstrap monorepo (`backend/`, `frontend/`, `infra/`).
- Setup CI/CD, quality gates, observabilidade base.
- Provisionamento Postgres + Redis + storage.

### Fase 1 — Identity + Workspace (2 semanas)
- Auth completo, RBAC, convites e membros.
- CRUD de workspaces e quotas iniciais.

### Fase 2 — Builder Core (3–4 semanas)
- Modelo de bot/versão/grafo.
- Editor visual mínimo com drag/drop e validação.
- Publicação de versão estável.

### Fase 3 — Runtime Engine (3 semanas)
- Sessão de chat, persistência de respostas.
- Navegação condicional e variáveis.
- Renderização viewer Nuxt.

### Fase 4 — Results + Analytics (2 semanas)
- Listagem de resultados, export e dashboard inicial.

### Fase 5 — Integrations + Billing (3 semanas)
- Webhook/HTTP/OpenAI/Stripe.
- Assinatura, webhooks de billing e enforcement de quotas.

### Fase 6 — Hardening + Go-live (2 semanas)
- Segurança, performance, carga, observabilidade avançada.
- Documentação operacional e runbooks.

## 17. Critérios de aceite

- CA-01: Usuário cria workspace e convida membro com sucesso.
- CA-02: Usuário cria bot, publica e executa sessão pública.
- CA-03: Respostas são persistidas e exportáveis.
- CA-04: Métricas de conclusão/drop-off aparecem no dashboard.
- CA-05: Limites de plano bloqueiam excedentes corretamente.
- CA-06: Integrações críticas funcionam com retry e log de falha.

## 18. Riscos e mitigação

- **Risco**: Complexidade do engine de fluxo.
  - **Mitigação**: DSL simples + testes de contrato por bloco.
- **Risco**: Custo de integrações externas.
  - **Mitigação**: fila assíncrona + retry seletivo + circuit breaker.
- **Risco**: Crescimento de dados de resultados.
  - **Mitigação**: particionamento por data/bot + arquivamento.

## 19. Mapeamento do monorepo original para o clone

- `apps/builder` → Nuxt módulo Builder
- `apps/viewer` → Nuxt módulo Runtime Viewer
- `apps/workflows` → Worker .NET (`BackgroundService` + filas)
- `packages/bot-engine` → `RuntimeEngine` (Application + Domain)
- `packages/chat-api` / `chat-session` → `Runtime API` + `Session Aggregate`
- `packages/results` → `Results & Analytics`
- `packages/workspaces` / `user` / `auth` → `Identity + Workspace`
- `packages/blocks-*` → catálogo de blocos e executores

## 20. Definições finais

### 20.1 Tecnologias recomendadas
- **Backend**: ASP.NET Core, EF Core, MediatR, FluentValidation, Serilog, OpenTelemetry.
- **Frontend**: Nuxt 4, Pinia, VueUse, Tailwind.
- **Infra**: PostgreSQL, Redis, MinIO/S3, RabbitMQ, Docker/Kubernetes.

### 20.2 Entregáveis
1. Documento de arquitetura (C4 + sequência).
2. OpenAPI v1 completo.
3. ADRs de decisões críticas.
4. Backlog detalhado por épico/feature.
5. Plano de rollout e migração.

---

## Apêndice A — Checklists por módulo

### A.1 Identity
- Registro/login/refresh/logout
- SSO
- Tokens revogáveis
- 2FA opcional

### A.2 Builder
- CRUD de blocos
- Validador de fluxo
- Histórico de versões
- Colaboração

### A.3 Runtime
- Sessões simultâneas
- Condições complexas
- Persistência resiliente
- Timeout e retomada

### A.4 Results
- Filtros
- Export
- Dashboard
- Auditoria
