# Implementação de Flow Nodes — .NET 8 + Nuxt 4 (Vue Flow)

> Foco: modelagem e implementação completa de **cada tipo de node** (backend + frontend), incluindo classes, enums, eventos, validadores, executores e estrutura de UI com `@vue-flow/core`.

---

## 1) Catálogo oficial de nodes

## 1.1 Enum central

```csharp
public enum FlowNodeType
{
  Start = 1,
  TextBubble = 2,
  ImageBubble = 3,
  VideoBubble = 4,
  AudioBubble = 5,
  EmbedBubble = 6,
  TextInput = 7,
  EmailInput = 8,
  PhoneInput = 9,
  DateInput = 10,
  ChoiceInput = 11,
  FileInput = 12,
  Condition = 13,
  Redirect = 14,
  Webhook = 15,
  HttpRequest = 16,
  OpenAi = 17,
  StripePayment = 18,
  Script = 19,
  End = 20
}
```

## 1.2 Classificação

- **System**: `Start`, `End`
- **Bubbles**: `TextBubble`, `ImageBubble`, `VideoBubble`, `AudioBubble`, `EmbedBubble`
- **Inputs**: `TextInput`, `EmailInput`, `PhoneInput`, `DateInput`, `ChoiceInput`, `FileInput`
- **Logic**: `Condition`, `Redirect`, `Script`
- **Integrations**: `Webhook`, `HttpRequest`, `OpenAi`, `StripePayment`

---

## 2) Backend — arquitetura para nodes

## 2.1 Entidades principais

```csharp
public sealed class FlowNode
{
  public string Id { get; private set; } = string.Empty;
  public FlowNodeType Type { get; private set; }
  public string Name { get; private set; } = string.Empty;
  public double PositionX { get; private set; }
  public double PositionY { get; private set; }
  public NodeExecutionPolicy ExecutionPolicy { get; private set; }
  public NodePayload Payload { get; private set; } = default!;

  private FlowNode() { }

  public static FlowNode Create(string id, FlowNodeType type, string name, double x, double y, NodePayload payload)
    => new()
    {
      Id = id,
      Type = type,
      Name = name,
      PositionX = x,
      PositionY = y,
      ExecutionPolicy = NodeExecutionPolicy.DefaultFor(type),
      Payload = payload
    };

  public void UpdatePosition(double x, double y)
  {
    PositionX = x;
    PositionY = y;
  }

  public void ReplacePayload(NodePayload payload) => Payload = payload;
}

public sealed class FlowEdge
{
  public string Id { get; private set; } = string.Empty;
  public string SourceNodeId { get; private set; } = string.Empty;
  public string SourceHandle { get; private set; } = string.Empty;
  public string TargetNodeId { get; private set; } = string.Empty;
  public string TargetHandle { get; private set; } = string.Empty;
  public EdgeCondition Condition { get; private set; } = default!;
}
```

## 2.2 Payload tipado por node

```csharp
public abstract record NodePayload;

public sealed record StartNodePayload() : NodePayload;
public sealed record EndNodePayload() : NodePayload;

public sealed record TextBubblePayload(string Text, bool UseMarkdown, int DelayMs) : NodePayload;
public sealed record ImageBubblePayload(string Url, string? Alt, string? Caption) : NodePayload;
public sealed record VideoBubblePayload(string Url, bool AutoPlay, bool Controls) : NodePayload;
public sealed record AudioBubblePayload(string Url, bool AutoPlay) : NodePayload;
public sealed record EmbedBubblePayload(string Url, int Height, bool Sandbox) : NodePayload;

public sealed record TextInputPayload(string VariableKey, bool Required, int? MinLength, int? MaxLength, string? Placeholder) : NodePayload;
public sealed record EmailInputPayload(string VariableKey, bool Required, string? Placeholder) : NodePayload;
public sealed record PhoneInputPayload(string VariableKey, bool Required, string? CountryCodeDefault) : NodePayload;
public sealed record DateInputPayload(string VariableKey, bool Required, DateTime? MinDateUtc, DateTime? MaxDateUtc) : NodePayload;
public sealed record ChoiceInputPayload(string VariableKey, bool Multiple, IReadOnlyList<ChoiceOption> Options) : NodePayload;
public sealed record FileInputPayload(string VariableKey, bool Required, int MaxSizeMb, IReadOnlyList<string> AllowedMimeTypes) : NodePayload;

public sealed record ConditionPayload(IReadOnlyList<ConditionRule> Rules, string Aggregator) : NodePayload;
public sealed record RedirectPayload(string Url, bool OpenInNewTab) : NodePayload;
public sealed record ScriptPayload(string ScriptCode, int TimeoutMs, bool Sandbox) : NodePayload;

public sealed record WebhookPayload(string Url, string Method, IReadOnlyList<KeyValuePair<string,string>> Headers, string? BodyTemplate) : NodePayload;
public sealed record HttpRequestPayload(string Url, string Method, int TimeoutMs, bool ParseAsJson) : NodePayload;
public sealed record OpenAiPayload(string Provider, string Model, string PromptTemplate, double Temperature, int MaxTokens) : NodePayload;
public sealed record StripePaymentPayload(string PriceId, string Currency, bool AllowCoupons, string SuccessRedirectUrl, string CancelRedirectUrl) : NodePayload;

public sealed record ChoiceOption(string Id, string Label, string Value);
public sealed record ConditionRule(string LeftExpression, string Operator, string RightExpression);
```

## 2.3 Node execution policy

```csharp
public sealed record NodeExecutionPolicy(
  bool WaitForUserInput,
  bool RetryOnFailure,
  int MaxRetries,
  int TimeoutMs)
{
  public static NodeExecutionPolicy DefaultFor(FlowNodeType type) => type switch
  {
    FlowNodeType.Webhook or FlowNodeType.HttpRequest or FlowNodeType.OpenAi => new(false, true, 3, 8000),
    FlowNodeType.Script => new(false, false, 0, 2000),
    FlowNodeType.StripePayment => new(true, false, 0, 120000),
    FlowNodeType.TextInput or FlowNodeType.EmailInput or FlowNodeType.PhoneInput or FlowNodeType.DateInput or FlowNodeType.ChoiceInput or FlowNodeType.FileInput => new(true, false, 0, 0),
    _ => new(false, false, 0, 0)
  };
}
```

---

## 3) Backend — serviços necessários

## 3.1 Registry + factory

```csharp
public interface INodeDefinition
{
  FlowNodeType Type { get; }
  string Category { get; }
  NodeCapability Capability { get; }
  NodePayload CreateDefaultPayload();
}

public sealed record NodeCapability(bool SupportsIncomingEdge, bool SupportsMultipleOutgoingEdges, bool RequiresVariableOutput);

public interface INodeDefinitionRegistry
{
  INodeDefinition Get(FlowNodeType type);
  IReadOnlyList<INodeDefinition> ListAll();
}

public interface INodePayloadSerializer
{
  string Serialize(NodePayload payload);
  NodePayload Deserialize(FlowNodeType type, string json);
}
```

## 3.2 Executor por tipo

```csharp
public interface INodeExecutor
{
  FlowNodeType Type { get; }
  Task<NodeExecutionResult> ExecuteAsync(NodeExecutionContext executionContext, FlowNode node, CancellationToken cancellationToken);
}

public sealed record NodeExecutionContext(
  Guid SessionId,
  Guid BotId,
  IDictionary<string, object?> Variables,
  string? UserInput,
  string Locale,
  string Timezone);

public sealed record NodeExecutionResult(
  NodeExecutionStatus Status,
  string? OutgoingHandle,
  IReadOnlyDictionary<string, object?> VariablesToSet,
  IReadOnlyList<NodeLogEntry> Logs,
  string? RenderInstructionJson);

public enum NodeExecutionStatus { Completed = 1, WaitingInput = 2, Failed = 3, RetriableFailure = 4 }

public sealed record NodeLogEntry(string Level, string Message, string? Details);
```

## 3.3 Serviços de suporte

- `IExpressionEvaluator` (Condition + templates)
- `IScriptSandboxRunner` (Script node)
- `IHttpIntegrationClient` (Webhook/HTTP)
- `IAiCompletionClient` (OpenAi)
- `IPaymentGatewayClient` (Stripe)
- `IFileSecurityScanner` (FileInput)
- `IRedirectSecurityValidator` (Redirect allow-list)

---

## 4) Backend — validação por node

## 4.1 Contrato

```csharp
public interface INodeValidator
{
  FlowNodeType Type { get; }
  IReadOnlyList<ValidationIssue> Validate(FlowNode node, FlowGraph graph);
}

public sealed record ValidationIssue(string Code, ValidationSeverity Severity, string Message, string? NodeId, string? EdgeId);
public enum ValidationSeverity { Info = 1, Warning = 2, Error = 3 }
```

## 4.2 Regras por tipo

### System
- `Start`: exatamente 1 por grafo; sem arestas de entrada.
- `End`: ao menos 1 no grafo; sem validação de saída obrigatória.

### Bubbles
- texto/url obrigatórios; URLs HTTPS válidas para mídia.

### Inputs
- `VariableKey` obrigatório e único em escopo do grafo.
- limites válidos (`min <= max`, mime types válidos, etc.).

### Logic
- `Condition`: ao menos uma regra e duas saídas (`true`/`false` handles).
- `Redirect`: URL segura (https, domínio permitido).
- `Script`: tamanho máximo de script, timeout máximo.

### Integrations
- credenciais/referências obrigatórias.
- timeout dentro do limite global.
- schemas de request/response válidos quando configurados.

---

## 5) Backend — eventos de domínio e integração

```csharp
public interface IDomainEvent { }

public sealed record FlowNodeAddedDomainEvent(Guid BotId, Guid VersionId, string NodeId, FlowNodeType NodeType, Guid ActorUserId) : IDomainEvent;
public sealed record FlowNodeUpdatedDomainEvent(Guid BotId, Guid VersionId, string NodeId, Guid ActorUserId) : IDomainEvent;
public sealed record FlowNodeRemovedDomainEvent(Guid BotId, Guid VersionId, string NodeId, Guid ActorUserId) : IDomainEvent;
public sealed record FlowEdgeAddedDomainEvent(Guid BotId, Guid VersionId, string EdgeId, string SourceNodeId, string TargetNodeId, Guid ActorUserId) : IDomainEvent;
public sealed record FlowEdgeRemovedDomainEvent(Guid BotId, Guid VersionId, string EdgeId, Guid ActorUserId) : IDomainEvent;
public sealed record FlowGraphValidatedDomainEvent(Guid BotId, Guid VersionId, bool HasErrors, int IssueCount) : IDomainEvent;

public sealed record NodeExecutionStartedIntegrationEvent(Guid SessionId, string NodeId, FlowNodeType Type);
public sealed record NodeExecutionFinishedIntegrationEvent(Guid SessionId, string NodeId, FlowNodeType Type, NodeExecutionStatus Status, long DurationMs);
public sealed record NodeExecutionFailedIntegrationEvent(Guid SessionId, string NodeId, FlowNodeType Type, string ErrorCode, string ErrorMessage);
```

---

## 6) Backend — DTOs e API para nodes

## 6.1 DTOs

```csharp
public sealed record FlowNodeDto(
  string Id,
  FlowNodeType Type,
  string Name,
  double PositionX,
  double PositionY,
  string PayloadJson,
  NodeExecutionPolicyDto ExecutionPolicy);

public sealed record NodeExecutionPolicyDto(bool WaitForUserInput, bool RetryOnFailure, int MaxRetries, int TimeoutMs);

public sealed record CreateNodeRequestDto(FlowNodeType Type, string Name, double PositionX, double PositionY, string? InitialPayloadJson);
public sealed record UpdateNodePayloadRequestDto(string PayloadJson, long ExpectedRevision);
public sealed record MoveNodeRequestDto(double PositionX, double PositionY, long ExpectedRevision);
public sealed record DeleteNodeRequestDto(long ExpectedRevision);
```

## 6.2 Endpoints

- `GET /api/v1/bots/{botId}/draft/nodes/catalog`
- `POST /api/v1/bots/{botId}/draft/nodes`
- `PATCH /api/v1/bots/{botId}/draft/nodes/{nodeId}/payload`
- `PATCH /api/v1/bots/{botId}/draft/nodes/{nodeId}/position`
- `DELETE /api/v1/bots/{botId}/draft/nodes/{nodeId}`
- `POST /api/v1/bots/{botId}/draft/edges`
- `DELETE /api/v1/bots/{botId}/draft/edges/{edgeId}`
- `POST /api/v1/bots/{botId}/draft/validate`

---

## 7) Frontend — estrutura completa com Vue Flow

## 7.1 Pacotes

- `@vue-flow/core`
- `@vue-flow/background`
- `@vue-flow/minimap`
- `@vue-flow/controls`

## 7.2 Estrutura de pastas (Nuxt)

```txt
app/
  features/builder/
    entities/
      nodeTypes.ts
      nodeModels.ts
      edgeModels.ts
    services/
      BuilderNodesHttpService.ts
      BuilderRealtimeService.ts
    stores/
      builderCanvasStore.ts
      builderInspectorStore.ts
      builderValidationStore.ts
    vue-flow/
      useVueFlowAdapters.ts
      useNodeFactory.ts
      useEdgeFactory.ts
      useNodeHandles.ts
      nodeRegistry.ts
    components/builder/flow/
      BuilderFlowCanvas.vue
      BuilderNodePalette.vue
      BuilderInspectorPanel.vue
      BuilderNodeToolbar.vue
      BuilderValidationSidebar.vue
      nodes/
        StartNode.vue
        EndNode.vue
        TextBubbleNode.vue
        ImageBubbleNode.vue
        VideoBubbleNode.vue
        AudioBubbleNode.vue
        EmbedBubbleNode.vue
        TextInputNode.vue
        EmailInputNode.vue
        PhoneInputNode.vue
        DateInputNode.vue
        ChoiceInputNode.vue
        FileInputNode.vue
        ConditionNode.vue
        RedirectNode.vue
        WebhookNode.vue
        HttpRequestNode.vue
        OpenAiNode.vue
        StripePaymentNode.vue
        ScriptNode.vue
      inspectors/
        StartNodeInspector.vue
        EndNodeInspector.vue
        TextBubbleInspector.vue
        ImageBubbleInspector.vue
        VideoBubbleInspector.vue
        AudioBubbleInspector.vue
        EmbedBubbleInspector.vue
        TextInputInspector.vue
        EmailInputInspector.vue
        PhoneInputInspector.vue
        DateInputInspector.vue
        ChoiceInputInspector.vue
        FileInputInspector.vue
        ConditionInspector.vue
        RedirectInspector.vue
        WebhookInspector.vue
        HttpRequestInspector.vue
        OpenAiInspector.vue
        StripePaymentInspector.vue
        ScriptInspector.vue
```

## 7.3 Modelo base frontend

```ts
export type BuilderNodeType =
  | 'Start'
  | 'TextBubble'
  | 'ImageBubble'
  | 'VideoBubble'
  | 'AudioBubble'
  | 'EmbedBubble'
  | 'TextInput'
  | 'EmailInput'
  | 'PhoneInput'
  | 'DateInput'
  | 'ChoiceInput'
  | 'FileInput'
  | 'Condition'
  | 'Redirect'
  | 'Webhook'
  | 'HttpRequest'
  | 'OpenAi'
  | 'StripePayment'
  | 'Script'
  | 'End'

export type BuilderNodeData = {
  id: string
  type: BuilderNodeType
  name: string
  payload: Record<string, unknown>
  executionPolicy: {
    waitForUserInput: boolean
    retryOnFailure: boolean
    maxRetries: number
    timeoutMs: number
  }
  validationIssues: {
    code: string
    severity: 'Info' | 'Warning' | 'Error'
    message: string
  }[]
}
```

## 7.4 Registro de node components

```ts
import StartNode from '~/components/builder/flow/nodes/StartNode.vue'
import EndNode from '~/components/builder/flow/nodes/EndNode.vue'
import TextBubbleNode from '~/components/builder/flow/nodes/TextBubbleNode.vue'
// ...demais imports

export const nodeTypes = {
  Start: StartNode,
  End: EndNode,
  TextBubble: TextBubbleNode,
  ImageBubble: () => import('~/components/builder/flow/nodes/ImageBubbleNode.vue'),
  VideoBubble: () => import('~/components/builder/flow/nodes/VideoBubbleNode.vue'),
  AudioBubble: () => import('~/components/builder/flow/nodes/AudioBubbleNode.vue'),
  EmbedBubble: () => import('~/components/builder/flow/nodes/EmbedBubbleNode.vue'),
  TextInput: () => import('~/components/builder/flow/nodes/TextInputNode.vue'),
  EmailInput: () => import('~/components/builder/flow/nodes/EmailInputNode.vue'),
  PhoneInput: () => import('~/components/builder/flow/nodes/PhoneInputNode.vue'),
  DateInput: () => import('~/components/builder/flow/nodes/DateInputNode.vue'),
  ChoiceInput: () => import('~/components/builder/flow/nodes/ChoiceInputNode.vue'),
  FileInput: () => import('~/components/builder/flow/nodes/FileInputNode.vue'),
  Condition: () => import('~/components/builder/flow/nodes/ConditionNode.vue'),
  Redirect: () => import('~/components/builder/flow/nodes/RedirectNode.vue'),
  Webhook: () => import('~/components/builder/flow/nodes/WebhookNode.vue'),
  HttpRequest: () => import('~/components/builder/flow/nodes/HttpRequestNode.vue'),
  OpenAi: () => import('~/components/builder/flow/nodes/OpenAiNode.vue'),
  StripePayment: () => import('~/components/builder/flow/nodes/StripePaymentNode.vue'),
  Script: () => import('~/components/builder/flow/nodes/ScriptNode.vue')
}
```

## 7.5 Canvas principal com Vue Flow

```vue
<script setup lang="ts">
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import { storeToRefs } from 'pinia'
import { useBuilderCanvasStore } from '~/stores/builderCanvasStore'
import { nodeTypes } from '~/features/builder/vue-flow/nodeRegistry'

const builderCanvasStore = useBuilderCanvasStore()
const { nodes, edges } = storeToRefs(builderCanvasStore)
</script>

<template>
  <VueFlow
    :nodes="nodes"
    :edges="edges"
    :node-types="nodeTypes"
    :fit-view-on-init="true"
    @nodes-change="builderCanvasStore.onNodesChange"
    @edges-change="builderCanvasStore.onEdgesChange"
    @connect="builderCanvasStore.onConnect"
    @node-drag-stop="builderCanvasStore.onNodeDragStop"
    @node-click="builderCanvasStore.onNodeClick"
  >
    <Background :gap="16" />
    <MiniMap />
    <Controls />
  </VueFlow>
</template>
```

## 7.6 Contrato visual por node

Cada `Node.vue` deve conter:
1. Header (ícone + nome + badge de tipo)
2. Preview resumida do payload
3. Handles (`source` e/ou `target`) definidos por tipo
4. Indicador de validação (error/warning)
5. Estado de colaboração (lock/edição remota)

### Exemplo `TextInputNode.vue` (estrutura)

```vue
<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import type { BuilderNodeData } from '~/features/builder/entities/nodeModels'

const props = defineProps<NodeProps<BuilderNodeData>>()
</script>

<template>
  <div class="builder-node input-node">
    <div class="node-header">Text Input</div>
    <div class="node-body">
      <div>Variável: {{ props.data.payload.variableKey }}</div>
      <div>Obrigatório: {{ props.data.payload.required ? 'Sim' : 'Não' }}</div>
    </div>

    <Handle id="in" type="target" :position="Position.Left" />
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
```

---

## 8) Implementação node a node (backend + frontend)

## 8.1 Start
- **Backend**: `StartNodePayload`; validação de unicidade e sem entrada.
- **Frontend**: `StartNode.vue` sem inspector complexo.
- **Handles**: apenas `source`.

## 8.2 End
- **Backend**: `EndNodePayload`; validação mínima.
- **Frontend**: `EndNode.vue`.
- **Handles**: apenas `target`.

## 8.3 TextBubble
- **Backend**: `TextBubblePayload(Text, UseMarkdown, DelayMs)` + `TextBubbleNodeExecutor`.
- **Frontend**: `TextBubbleNode.vue` + `TextBubbleInspector.vue` (textarea markdown).
- **Validação**: texto obrigatório, tamanho máximo.

## 8.4 ImageBubble
- **Backend**: `ImageBubblePayload(Url, Alt, Caption)` + URL validator.
- **Frontend**: preview de thumbnail.
- **Validação**: URL https + extensão/mime permitidos.

## 8.5 VideoBubble
- **Backend**: `VideoBubblePayload(Url, AutoPlay, Controls)`.
- **Frontend**: preview de player placeholder.
- **Validação**: URL suportada + regras autoplay.

## 8.6 AudioBubble
- **Backend**: `AudioBubblePayload(Url, AutoPlay)`.
- **Frontend**: preview waveform simples.
- **Validação**: formato suportado.

## 8.7 EmbedBubble
- **Backend**: `EmbedBubblePayload(Url, Height, Sandbox)`.
- **Frontend**: preview com iframe bloqueado em edição.
- **Validação**: domínio allow-list + altura mínima/máxima.

## 8.8 TextInput
- **Backend**: `TextInputPayload` + output em variável.
- **Frontend**: inspector com key/required/length.
- **Validação**: `VariableKey` obrigatório e único.

## 8.9 EmailInput
- **Backend**: regex/validator de email no executor.
- **Frontend**: placeholder + required.
- **Validação**: variável obrigatória.

## 8.10 PhoneInput
- **Backend**: normalização E.164.
- **Frontend**: selector de país padrão.
- **Validação**: country code válido.

## 8.11 DateInput
- **Backend**: min/max date + parsing robusto.
- **Frontend**: date picker no inspector.
- **Validação**: `min <= max`.

## 8.12 ChoiceInput
- **Backend**: lista de opções e `Multiple`.
- **Frontend**: editor de opções (add/remove/reorder).
- **Validação**: >= 2 opções, ids únicos.

## 8.13 FileInput
- **Backend**: max size + mime allow-list + scan.
- **Frontend**: config de limite/tipos.
- **Validação**: limites positivos e mime válido.

## 8.14 Condition
- **Backend**: `ConditionPayload` + evaluator;
- **Frontend**: builder de regras;
- **Handles**: `source:true`, `source:false`.
- **Validação**: ao menos 1 regra e duas saídas conectáveis.

## 8.15 Redirect
- **Backend**: `RedirectPayload` + `IRedirectSecurityValidator`.
- **Frontend**: URL + open in new tab.
- **Validação**: URL segura.

## 8.16 Webhook
- **Backend**: `WebhookPayload` + executor HTTP com retry.
- **Frontend**: editor método/headers/body.
- **Validação**: URL, método e timeout.

## 8.17 HttpRequest
- **Backend**: `HttpRequestPayload` + parse JSON opcional.
- **Frontend**: config request/response mapping.
- **Validação**: status esperado/schema opcional.

## 8.18 OpenAi
- **Backend**: `OpenAiPayload` + `IAiCompletionClient`.
- **Frontend**: model/prompt/temperature.
- **Validação**: model e prompt obrigatórios.

## 8.19 StripePayment
- **Backend**: `StripePaymentPayload` + criação sessão checkout.
- **Frontend**: `priceId`, redirects, cupons.
- **Validação**: priceId e urls obrigatórios.

## 8.20 Script
- **Backend**: `ScriptPayload` + sandbox isolado com timeout.
- **Frontend**: editor de código com lint mínimo.
- **Validação**: limite de tamanho e APIs proibidas.

---

## 9) Realtime e colaboração (nodes)

## 9.1 Eventos websocket/signalR

- `node.added`
- `node.updated`
- `node.moved`
- `node.deleted`
- `edge.added`
- `edge.deleted`
- `node.validation.updated`
- `presence.cursor.updated`
- `presence.selection.updated`

## 9.2 Lock otimista

- Edição por revisão (`expectedRevision`).
- UI exibe conflito ao salvar payload/posição.
- Botão “Recarregar versão remota”.

---

## 10) Checklist técnico por node

Para cada node implementar:
1. `Payload record` (backend)
2. `NodeDefinition` (catálogo)
3. `NodeValidator`
4. `NodeExecutor`
5. `Node.vue` (Vue Flow)
6. `NodeInspector.vue`
7. testes unitários:
   - payload validator
   - executor success/failure
8. teste e2e builder:
   - adicionar node
   - configurar node
   - conectar arestas
   - validar e publicar

---

## 11) Matriz de classes sugeridas (backend)

- `FlowNode` / `FlowEdge` / `FlowGraph`
- `NodePayload` + 20 payload records
- `NodeExecutionPolicy`
- `INodeDefinition`, `NodeDefinitionRegistry`
- `INodePayloadSerializer`
- `INodeValidator` + 20 validators
- `INodeExecutor` + 20 executors
- `FlowGraphOrchestratorService`
- `FlowGraphValidationService`
- `NodeExecutionTelemetryService`

## 12) Matriz de componentes sugeridos (frontend)

- `BuilderFlowCanvas.vue`
- `BuilderNodePalette.vue`
- `BuilderInspectorPanel.vue`
- `BuilderValidationSidebar.vue`
- 20x `Node.vue`
- 20x `NodeInspector.vue`
- `useNodeFactory.ts`
- `useEdgeFactory.ts`
- `useNodeHandles.ts`
- `builderCanvasStore.ts`
- `builderValidationStore.ts`


---

## 13) Especificação detalhada de inputs/campos por node

> Convenções:
> - **Tipo** = tipo de dado no backend (C#) / frontend (TS)
> - **Obrigatório** = se precisa existir para salvar/publicar
> - **Default** = valor ao criar node
> - **Validação** = regra mínima para RF-026
> - **Mapeamento variável** = campo que grava output no contexto da sessão

## 13.1 StartNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `label` | `string` | não | `"Início"` | máx. 50 chars | somente visual |
| `entryMessage` | `string?` | não | `null` | máx. 500 chars | opcional para telemetria/presença |

## 13.2 EndNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `label` | `string` | não | `"Fim"` | máx. 50 chars | somente visual |
| `completionTag` | `string?` | não | `null` | slug alfanumérico com `-` | usado em analytics/funnel |

## 13.3 TextBubbleNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `text` | `string` | sim | `""` | 1..4000 chars | suporta variáveis `{{var}}` |
| `useMarkdown` | `bool` | não | `true` | n/a | render markdown controlado |
| `typingDelayMs` | `int` | não | `300` | 0..10000 | simulação de digitação |
| `showAvatar` | `bool` | não | `true` | n/a | visual |
| `avatarUrl` | `string?` | não | `null` | URL https válida | opcional |

## 13.4 ImageBubbleNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `url` | `string` | sim | `""` | URL https + mime imagem | pode conter variável |
| `alt` | `string?` | não | `null` | máx. 200 chars | acessibilidade |
| `caption` | `string?` | não | `null` | máx. 300 chars | texto auxiliar |
| `widthMode` | `string` (`auto/full`) | não | `"auto"` | enum | layout |
| `clickAction` | `string` (`none/open-url`) | não | `"none"` | enum | interação |
| `targetUrl` | `string?` | condicional | `null` | obrigatório se `clickAction=open-url` | URL segura |

## 13.5 VideoBubbleNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `url` | `string` | sim | `""` | URL https válida | mp4/hls/youtube embed controlado |
| `autoPlay` | `bool` | não | `false` | n/a | respeitar política browser |
| `muted` | `bool` | não | `true` | n/a | exigido para autoplay em alguns browsers |
| `controls` | `bool` | não | `true` | n/a | UI player |
| `loop` | `bool` | não | `false` | n/a | repetição |
| `startAtSeconds` | `int` | não | `0` | >= 0 | ponto inicial |

## 13.6 AudioBubbleNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `url` | `string` | sim | `""` | URL https + mime áudio | mp3/wav/ogg |
| `autoPlay` | `bool` | não | `false` | n/a | UX sensível |
| `showWaveform` | `bool` | não | `true` | n/a | somente visual |
| `transcript` | `string?` | não | `null` | máx. 4000 | acessibilidade/SEO interno |

## 13.7 EmbedBubbleNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `url` | `string` | sim | `""` | https + allow-list | anti-phishing |
| `height` | `int` | não | `420` | 200..1200 | altura iframe |
| `sandbox` | `bool` | não | `true` | n/a | segurança |
| `allow` | `string?` | não | `null` | lista controlada | permissões iframe |

## 13.8 TextInputNode

| Campo | Tipo | Obrigatório | Default | Validação | Mapeamento variável |
|---|---|---:|---|---|---|
| `variableKey` | `string` | sim | `""` | regex `^[a-zA-Z_][a-zA-Z0-9_]*$` | grava resposta em `variables[variableKey]` |
| `label` | `string` | não | `"Digite sua resposta"` | máx. 120 | prompt |
| `placeholder` | `string?` | não | `null` | máx. 120 | UX |
| `required` | `bool` | não | `true` | n/a | obrigatório |
| `minLength` | `int?` | não | `null` | >=0 e <= `maxLength` | limite mínimo |
| `maxLength` | `int?` | não | `500` | 1..5000 | limite máximo |
| `regexPattern` | `string?` | não | `null` | regex compilável | validação custom |
| `errorMessage` | `string?` | não | `null` | máx. 200 | fallback i18n |

## 13.9 EmailInputNode

| Campo | Tipo | Obrigatório | Default | Validação | Mapeamento variável |
|---|---|---:|---|---|---|
| `variableKey` | `string` | sim | `"email"` | chave única | `variables[variableKey]` |
| `label` | `string` | não | `"Qual seu e-mail?"` | máx. 120 | prompt |
| `placeholder` | `string?` | não | `"voce@empresa.com"` | máx. 120 | UX |
| `required` | `bool` | não | `true` | n/a | obrigatório |
| `allowDisposable` | `bool` | não | `false` | n/a | bloqueio de temporários |
| `domainAllowList` | `string[]` | não | `[]` | domínios válidos | opcional B2B |
| `domainDenyList` | `string[]` | não | `[]` | domínios válidos | bloqueio |

## 13.10 PhoneInputNode

| Campo | Tipo | Obrigatório | Default | Validação | Mapeamento variável |
|---|---|---:|---|---|---|
| `variableKey` | `string` | sim | `"phone"` | chave única | `variables[variableKey]` |
| `label` | `string` | não | `"Seu telefone"` | máx. 120 | prompt |
| `required` | `bool` | não | `true` | n/a | obrigatório |
| `defaultCountry` | `string` (ISO2) | não | `"BR"` | ISO 3166-1 alpha-2 | país padrão |
| `allowedCountries` | `string[]` | não | `[]` | ISO2 válidos | restrição opcional |
| `format` | `string` (`E164`/`national`) | não | `"E164"` | enum | persistência recomendada `E164` |

## 13.11 DateInputNode

| Campo | Tipo | Obrigatório | Default | Validação | Mapeamento variável |
|---|---|---:|---|---|---|
| `variableKey` | `string` | sim | `"date"` | chave única | `variables[variableKey]` |
| `label` | `string` | não | `"Escolha uma data"` | máx. 120 | prompt |
| `required` | `bool` | não | `true` | n/a | obrigatório |
| `minDateUtc` | `DateTime?` | não | `null` | <= `maxDateUtc` | faixa mínima |
| `maxDateUtc` | `DateTime?` | não | `null` | >= `minDateUtc` | faixa máxima |
| `disableWeekends` | `bool` | não | `false` | n/a | casos de agendamento |
| `outputFormat` | `string` (`ISO`/`locale`) | não | `"ISO"` | enum | backend deve receber ISO |

## 13.12 ChoiceInputNode

| Campo | Tipo | Obrigatório | Default | Validação | Mapeamento variável |
|---|---|---:|---|---|---|
| `variableKey` | `string` | sim | `"choice"` | chave única | `variables[variableKey]` |
| `label` | `string` | não | `"Escolha uma opção"` | máx. 120 | prompt |
| `required` | `bool` | não | `true` | n/a | obrigatório |
| `multiple` | `bool` | não | `false` | n/a | single/multi |
| `minSelections` | `int?` | condicional | `null` | >=1 se `multiple=true` | mínimo seleção |
| `maxSelections` | `int?` | condicional | `null` | >= `minSelections` | máximo seleção |
| `options` | `ChoiceOption[]` | sim | `[]` | mínimo 2 opções | lista principal |
| `randomize` | `bool` | não | `false` | n/a | randomização |

**ChoiceOption**
| Campo | Tipo | Obrigatório | Validação |
|---|---|---:|---|
| `id` | `string` | sim | único no node |
| `label` | `string` | sim | 1..120 chars |
| `value` | `string` | sim | 1..200 chars |
| `imageUrl` | `string?` | não | https válida |

## 13.13 FileInputNode

| Campo | Tipo | Obrigatório | Default | Validação | Mapeamento variável |
|---|---|---:|---|---|---|
| `variableKey` | `string` | sim | `"file"` | chave única | URL(s) do arquivo em `variables` |
| `label` | `string` | não | `"Envie um arquivo"` | máx. 120 | prompt |
| `required` | `bool` | não | `true` | n/a | obrigatório |
| `maxSizeMb` | `int` | não | `10` | 1..100 | tamanho máximo |
| `maxFiles` | `int` | não | `1` | 1..10 | múltiplos anexos |
| `allowedMimeTypes` | `string[]` | não | `[]` | mime válidos | whitelist |
| `allowedExtensions` | `string[]` | não | `[]` | sem ponto (`pdf`) | fallback |
| `virusScanRequired` | `bool` | não | `true` | n/a | segurança |

## 13.14 ConditionNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `aggregator` | `string` (`AND`/`OR`) | não | `"AND"` | enum | combinador |
| `rules` | `ConditionRule[]` | sim | `[]` | >=1 regra | avaliação lógica |
| `fallbackHandle` | `string` | não | `"false"` | `true/false/custom` | rota fallback |

**ConditionRule**
| Campo | Tipo | Obrigatório | Validação |
|---|---|---:|---|
| `leftExpression` | `string` | sim | expressão compilável |
| `operator` | `string` | sim | enum comparador |
| `rightExpression` | `string` | condicional | obrigatório exceto `isEmpty` |
| `ignoreCase` | `bool` | não | default `true` |

## 13.15 RedirectNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `url` | `string` | sim | `""` | https + allow-list | destino |
| `openInNewTab` | `bool` | não | `true` | n/a | target |
| `delayMs` | `int` | não | `0` | 0..10000 | atraso antes redirecionar |
| `trackClick` | `bool` | não | `true` | n/a | analytics |

## 13.16 WebhookNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `url` | `string` | sim | `""` | https válida | endpoint externo |
| `method` | `string` | não | `"POST"` | enum HTTP | verbo |
| `headers` | `KeyValue[]` | não | `[]` | keys únicas | cabeçalhos |
| `queryParams` | `KeyValue[]` | não | `[]` | keys únicas | query string |
| `bodyTemplate` | `string?` | não | `null` | JSON/template válido | corpo |
| `timeoutMs` | `int` | não | `8000` | 100..30000 | timeout |
| `retryCount` | `int` | não | `3` | 0..5 | retentativas |
| `saveResponseAs` | `string?` | não | `null` | variável válida | armazena resposta |

## 13.17 HttpRequestNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `url` | `string` | sim | `""` | https válida | endpoint |
| `method` | `string` | não | `"GET"` | enum HTTP | verbo |
| `headers` | `KeyValue[]` | não | `[]` | keys únicas | headers |
| `timeoutMs` | `int` | não | `8000` | 100..30000 | timeout |
| `parseAsJson` | `bool` | não | `true` | n/a | parser |
| `expectedStatusCodes` | `int[]` | não | `[200]` | 100..599 | sucesso esperado |
| `responseMapping` | `MappingRule[]` | não | `[]` | paths válidos | map para variáveis |

## 13.18 OpenAiNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `provider` | `string` | não | `"openai"` | enum provider | provedor LLM |
| `model` | `string` | sim | `"gpt-4o-mini"` | lista permitida | modelo |
| `promptTemplate` | `string` | sim | `""` | 1..16000 chars | prompt com variáveis |
| `temperature` | `double` | não | `0.7` | 0..2 | criatividade |
| `maxTokens` | `int` | não | `512` | 1..4096 (ou limite model) | custo/latência |
| `topP` | `double?` | não | `null` | 0..1 | sampling |
| `saveResponseAs` | `string` | sim | `"ai_response"` | variável válida | saída |
| `systemMessage` | `string?` | não | `null` | máx. 8000 | instruções |

## 13.19 StripePaymentNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `priceId` | `string` | sim | `""` | formato stripe válido | produto/preço |
| `currency` | `string` | não | `"BRL"` | ISO 4217 | moeda |
| `quantity` | `int` | não | `1` | >=1 | quantidade |
| `allowCoupons` | `bool` | não | `true` | n/a | promoções |
| `successRedirectUrl` | `string` | sim | `""` | https válida | pós pagamento |
| `cancelRedirectUrl` | `string` | sim | `""` | https válida | cancelamento |
| `savePaymentStatusAs` | `string` | não | `"payment_status"` | variável válida | status final |
| `saveSessionIdAs` | `string` | não | `"stripe_session_id"` | variável válida | auditoria |

## 13.20 ScriptNode

| Campo | Tipo | Obrigatório | Default | Validação | Observações |
|---|---|---:|---|---|---|
| `scriptCode` | `string` | sim | `""` | 1..20000 chars | código JS sandbox |
| `timeoutMs` | `int` | não | `1500` | 100..5000 | hard timeout |
| `sandbox` | `bool` | não | `true` | deve ser `true` em prod | segurança |
| `allowedApis` | `string[]` | não | `[]` | allow-list fixa | controle |
| `saveResultAs` | `string?` | não | `null` | variável válida | saída do script |
| `onError` | `string` (`fail/continue`) | não | `"fail"` | enum | estratégia erro |

## 13.21 Estruturas auxiliares reutilizáveis

```csharp
public sealed record KeyValue(string Key, string Value);
public sealed record MappingRule(string SourcePath, string TargetVariableKey, string? Transform);
```

```ts
export type KeyValue = { key: string; value: string }
export type MappingRule = { sourcePath: string; targetVariableKey: string; transform?: string | null }
```

## 13.22 Schema de handles por node (Vue Flow)

| Node | Handles de entrada | Handles de saída |
|---|---|---|
| Start | nenhum | `out` |
| End | `in` | nenhum |
| Bubbles (Text/Image/Video/Audio/Embed) | `in` | `out` |
| Inputs (Text/Email/Phone/Date/Choice/File) | `in` | `out` |
| Condition | `in` | `true`, `false` |
| Redirect | `in` | nenhum (ou `out` opcional se modo continue) |
| Webhook | `in` | `success`, `error` |
| HttpRequest | `in` | `success`, `error` |
| OpenAi | `in` | `success`, `error` |
| StripePayment | `in` | `paid`, `canceled`, `failed` |
| Script | `in` | `success`, `error` |

## 13.23 Campos mínimos para publish (hard requirements)

- `TextBubble.text`
- `ImageBubble.url`
- `VideoBubble.url`
- `AudioBubble.url`
- `EmbedBubble.url`
- `TextInput.variableKey`
- `EmailInput.variableKey`
- `PhoneInput.variableKey`
- `DateInput.variableKey`
- `ChoiceInput.variableKey` + `options >= 2`
- `FileInput.variableKey` + `maxSizeMb`
- `Condition.rules >= 1` + arestas `true/false`
- `Redirect.url`
- `Webhook.url` + `method`
- `HttpRequest.url` + `method`
- `OpenAi.model` + `promptTemplate` + `saveResponseAs`
- `StripePayment.priceId` + `successRedirectUrl` + `cancelRedirectUrl`
- `Script.scriptCode`

## 13.24 Campos de UI no inspector por node (frontend)

Cada `NodeInspector.vue` deve conter os grupos:
1. **Conteúdo** (payload principal)
2. **Validação** (required, ranges, regex)
3. **Persistência** (variável de output)
4. **Execução** (timeout/retry/onError)
5. **Avançado** (headers, mappings, CSS, segurança)

Padrão de componente de campo:
- `FieldText.vue`
- `FieldTextarea.vue`
- `FieldNumber.vue`
- `FieldToggle.vue`
- `FieldSelect.vue`
- `FieldKeyValueTable.vue`
- `FieldMappingTable.vue`
- `FieldVariableKey.vue`

## 13.25 Eventos de alteração de campos (telemetria)

- `builder.node.field.updated`
  - `nodeType`
  - `nodeId`
  - `fieldName`
  - `oldValueHash`
  - `newValueHash`
  - `actorUserId`
- `builder.node.validation.error`
  - `nodeType`
  - `nodeId`
  - `fieldName`
  - `errorCode`

## 13.26 Testes obrigatórios de campos

Para cada node:
1. salvar payload válido
2. bloquear payload inválido
3. persistir defaults
4. refletir no preview/resumo do node
5. serializar/desserializar sem perda

