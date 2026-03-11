# Implementação Completa — RF-020 ao RF-026 (.NET 8 + Nuxt 4)

> Documento de implementação completa para os requisitos de **Builder**: RF-020 até RF-026.
>
> - **RF-020**: Criar bot do zero ou por template.
> - **RF-021**: Modelar bot por blocos e arestas.
> - **RF-022**: Versionamento rascunho/publicado.
> - **RF-023**: Pré-visualização em tempo real.
> - **RF-024**: Tema visual configurável.
> - **RF-025**: Colaboração com permissões.
> - **RF-026**: Validação de fluxo antes de publicar.

---

## 1) Arquitetura de implementação

## 1.1 Backend (Clean Architecture)

```txt
src/
  TypebotClone.Domain/
    Bots/
      Bot.cs
      BotVersion.cs
      BotCollaborator.cs
      FlowGraph.cs
      FlowNode.cs
      FlowEdge.cs
      BotTheme.cs
      BotTemplate.cs
      BotValidationResult.cs
      Events/
  TypebotClone.Application/
    Bots/
      Commands/
      Queries/
      DTOs/
      Services/
      Policies/
  TypebotClone.Infrastructure/
    Persistence/
      Configurations/
      Repositories/
    Realtime/
      SignalR/
    Storage/
      JsonSnapshotStore/
  TypebotClone.Api/
    Controllers/
      BotsController.cs
      BotBuilderRealtimeHub.cs
```

## 1.2 Frontend (Nuxt 4)

```txt
frontend/
  app/
    entities/builder/
    interfaces/builder/
    services/builder/
    stores/
      builderStore.ts
      builderCollaborationStore.ts
    components/builder/
      graph/
      sidebar/
      inspector/
      collaboration/
      preview/
      validation/
    pages/workspaces/[workspaceId]/bots/
      index.vue
      create.vue
      [botId]/builder.vue
      [botId]/versions.vue
      [botId]/theme.vue
```

---

## 2) Modelo de domínio (classes e enums concretos)

## 2.1 Enums

```csharp
public enum BotStatus { Draft = 1, Published = 2, Archived = 3 }
public enum BotVisibility { Private = 1, Workspace = 2, Public = 3 }
public enum BotVersionStatus { Draft = 1, Published = 2 }
public enum CollaborationType { Read = 1, Edit = 2, Admin = 3 }

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

public enum EdgeConditionOperator
{
  Always = 1,
  Equals = 2,
  NotEquals = 3,
  Contains = 4,
  GreaterThan = 5,
  LessThan = 6,
  IsEmpty = 7,
  IsNotEmpty = 8
}

public enum ThemeMode { Light = 1, Dark = 2, Auto = 3 }
public enum ValidationSeverity { Info = 1, Warning = 2, Error = 3 }
```

## 2.2 Aggregate raiz `Bot`

```csharp
public sealed class Bot : AggregateRoot<Guid>
{
  private readonly List<BotVersion> _versions = [];
  private readonly List<BotCollaborator> _collaborators = [];

  public Guid WorkspaceId { get; private set; }
  public string Name { get; private set; } = string.Empty;
  public string? Icon { get; private set; }
  public string PublicSlug { get; private set; } = string.Empty;
  public BotStatus Status { get; private set; } = BotStatus.Draft;
  public BotVisibility Visibility { get; private set; } = BotVisibility.Private;
  public Guid CurrentDraftVersionId { get; private set; }
  public Guid? PublishedVersionId { get; private set; }

  public IReadOnlyCollection<BotVersion> Versions => _versions;
  public IReadOnlyCollection<BotCollaborator> Collaborators => _collaborators;

  private Bot() { }

  public static Bot CreateEmpty(Guid workspaceId, Guid actorUserId, string name, string publicSlug)
  {
    var bot = new Bot
    {
      Id = Guid.NewGuid(),
      WorkspaceId = workspaceId,
      Name = name,
      PublicSlug = publicSlug,
      Visibility = BotVisibility.Private,
      Status = BotStatus.Draft
    };

    var draftVersion = BotVersion.CreateDraft(bot.Id, actorUserId, "v1-draft", FlowGraph.CreateDefault(), BotTheme.Default());
    bot.CurrentDraftVersionId = draftVersion.Id;
    bot._versions.Add(draftVersion);
    bot._collaborators.Add(BotCollaborator.Create(bot.Id, actorUserId, CollaborationType.Admin));
    bot.Raise(new BotCreatedDomainEvent(bot.Id, workspaceId, actorUserId));
    return bot;
  }

  public static Bot CreateFromTemplate(Guid workspaceId, Guid actorUserId, string name, string publicSlug, BotTemplate template)
  {
    var bot = CreateEmpty(workspaceId, actorUserId, name, publicSlug);
    var draftVersion = bot._versions.Single(x => x.Id == bot.CurrentDraftVersionId);
    draftVersion.ReplaceGraph(template.GraphSnapshot);
    draftVersion.ReplaceTheme(template.ThemeSnapshot);
    bot.Raise(new BotCreatedFromTemplateDomainEvent(bot.Id, template.Id, actorUserId));
    return bot;
  }

  public BotVersion GetDraftVersion() => _versions.Single(version => version.Id == CurrentDraftVersionId);

  public void Rename(string newName)
  {
    Name = newName;
    Touch();
    Raise(new BotUpdatedDomainEvent(Id));
  }

  public void UpdateDraftGraph(Guid actorUserId, FlowGraph newGraph, long expectedRevision)
  {
    EnsureCanEdit(actorUserId);
    var draftVersion = GetDraftVersion();
    draftVersion.UpdateGraph(newGraph, expectedRevision);
    Raise(new BotDraftUpdatedDomainEvent(Id, draftVersion.Id, actorUserId));
  }

  public void UpdateDraftTheme(Guid actorUserId, BotTheme newTheme)
  {
    EnsureCanEdit(actorUserId);
    var draftVersion = GetDraftVersion();
    draftVersion.ReplaceTheme(newTheme);
    Raise(new BotThemeUpdatedDomainEvent(Id, draftVersion.Id, actorUserId));
  }

  public BotVersion Publish(Guid actorUserId, BotValidationResult validationResult)
  {
    EnsureCanPublish(actorUserId);
    if (validationResult.HasErrors) throw new InvalidOperationException("Bot validation failed");

    var draftVersion = GetDraftVersion();
    draftVersion.MarkPublished();
    PublishedVersionId = draftVersion.Id;
    Status = BotStatus.Published;

    var nextDraftVersion = BotVersion.CreateDraft(Id, actorUserId, draftVersion.GetNextDraftTag(), draftVersion.Graph, draftVersion.Theme);
    _versions.Add(nextDraftVersion);
    CurrentDraftVersionId = nextDraftVersion.Id;

    Raise(new BotPublishedDomainEvent(Id, draftVersion.Id, actorUserId));
    return draftVersion;
  }

  public void AddCollaborator(Guid actorUserId, Guid targetUserId, CollaborationType collaborationType)
  {
    EnsureIsAdmin(actorUserId);
    var existingCollaborator = _collaborators.SingleOrDefault(collaborator => collaborator.UserId == targetUserId);
    if (existingCollaborator is not null)
    {
      existingCollaborator.ChangePermission(collaborationType);
      Raise(new BotCollaboratorPermissionChangedDomainEvent(Id, targetUserId, collaborationType, actorUserId));
      return;
    }

    _collaborators.Add(BotCollaborator.Create(Id, targetUserId, collaborationType));
    Raise(new BotCollaboratorAddedDomainEvent(Id, targetUserId, collaborationType, actorUserId));
  }

  public void RemoveCollaborator(Guid actorUserId, Guid targetUserId)
  {
    EnsureIsAdmin(actorUserId);
    var collaborator = _collaborators.Single(collaborator => collaborator.UserId == targetUserId);
    _collaborators.Remove(collaborator);
    Raise(new BotCollaboratorRemovedDomainEvent(Id, targetUserId, actorUserId));
  }

  private void EnsureCanEdit(Guid actorUserId)
  {
    if (_collaborators.Any(collaborator => collaborator.UserId == actorUserId && collaborator.Permission is CollaborationType.Edit or CollaborationType.Admin)) return;
    throw new InvalidOperationException("User does not have edit permission");
  }

  private void EnsureCanPublish(Guid actorUserId)
  {
    if (_collaborators.Any(collaborator => collaborator.UserId == actorUserId && collaborator.Permission == CollaborationType.Admin)) return;
    throw new InvalidOperationException("User does not have publish permission");
  }

  private void EnsureIsAdmin(Guid actorUserId)
  {
    if (_collaborators.Any(collaborator => collaborator.UserId == actorUserId && collaborator.Permission == CollaborationType.Admin)) return;
    throw new InvalidOperationException("User does not have admin permission");
  }
}
```

## 2.3 Versionamento

```csharp
public sealed class BotVersion : Entity<Guid>
{
  public Guid BotId { get; private set; }
  public string Tag { get; private set; } = string.Empty;
  public BotVersionStatus Status { get; private set; } = BotVersionStatus.Draft;
  public Guid CreatedByUserId { get; private set; }
  public DateTime CreatedAtUtc { get; private set; } = DateTime.UtcNow;
  public DateTime? PublishedAtUtc { get; private set; }
  public long Revision { get; private set; } = 1;

  public FlowGraph Graph { get; private set; } = default!;
  public BotTheme Theme { get; private set; } = default!;

  private BotVersion() { }

  public static BotVersion CreateDraft(Guid botId, Guid createdByUserId, string tag, FlowGraph graph, BotTheme theme)
    => new()
    {
      Id = Guid.NewGuid(),
      BotId = botId,
      CreatedByUserId = createdByUserId,
      Tag = tag,
      Status = BotVersionStatus.Draft,
      Graph = graph,
      Theme = theme,
      Revision = 1
    };

  public void UpdateGraph(FlowGraph newGraph, long expectedRevision)
  {
    if (Status != BotVersionStatus.Draft) throw new InvalidOperationException("Only draft is editable");
    if (expectedRevision != Revision) throw new InvalidOperationException("Revision conflict");
    Graph = newGraph;
    Revision++;
  }

  public void ReplaceGraph(FlowGraph graph)
  {
    Graph = graph;
    Revision++;
  }

  public void ReplaceTheme(BotTheme theme)
  {
    Theme = theme;
    Revision++;
  }

  public void MarkPublished()
  {
    if (Status != BotVersionStatus.Draft) throw new InvalidOperationException("Version already published");
    Status = BotVersionStatus.Published;
    PublishedAtUtc = DateTime.UtcNow;
  }

  public string GetNextDraftTag() => $"{Tag}-next-draft";
}
```

## 2.4 Grafo de fluxo

```csharp
public sealed class FlowGraph
{
  public string StartNodeId { get; private set; } = string.Empty;
  public IReadOnlyList<FlowNode> Nodes { get; private set; } = [];
  public IReadOnlyList<FlowEdge> Edges { get; private set; } = [];

  private FlowGraph() { }

  public static FlowGraph CreateDefault()
  {
    var startNode = FlowNode.CreateStart("start-node");
    var firstBubble = FlowNode.Create("text-1", FlowNodeType.TextBubble, "{ \"text\": \"Olá!\" }");
    var edge = FlowEdge.Create("edge-1", startNode.Id, firstBubble.Id, EdgeCondition.Always());

    return new FlowGraph
    {
      StartNodeId = startNode.Id,
      Nodes = [startNode, firstBubble],
      Edges = [edge]
    };
  }
}

public sealed class FlowNode
{
  public string Id { get; private set; } = string.Empty;
  public FlowNodeType Type { get; private set; }
  public string ConfigJson { get; private set; } = "{}";
  public double PositionX { get; private set; }
  public double PositionY { get; private set; }

  private FlowNode() { }

  public static FlowNode CreateStart(string id) => new() { Id = id, Type = FlowNodeType.Start, ConfigJson = "{}", PositionX = 100, PositionY = 100 };

  public static FlowNode Create(string id, FlowNodeType type, string configJson) => new()
  {
    Id = id,
    Type = type,
    ConfigJson = configJson,
    PositionX = 100,
    PositionY = 100
  };
}

public sealed class FlowEdge
{
  public string Id { get; private set; } = string.Empty;
  public string SourceNodeId { get; private set; } = string.Empty;
  public string TargetNodeId { get; private set; } = string.Empty;
  public EdgeCondition Condition { get; private set; } = default!;

  private FlowEdge() { }

  public static FlowEdge Create(string id, string sourceNodeId, string targetNodeId, EdgeCondition condition)
    => new() { Id = id, SourceNodeId = sourceNodeId, TargetNodeId = targetNodeId, Condition = condition };
}

public sealed record EdgeCondition(EdgeConditionOperator Operator, string? LeftValue, string? RightValue)
{
  public static EdgeCondition Always() => new(EdgeConditionOperator.Always, null, null);
}
```

## 2.5 Tema

```csharp
public sealed record BotTheme(
  ThemeMode Mode,
  string FontFamily,
  string PrimaryColor,
  string BackgroundColor,
  int BorderRadius,
  string? CustomCss)
{
  public static BotTheme Default() => new(
    ThemeMode.Light,
    "Inter",
    "#2563eb",
    "#ffffff",
    12,
    null);
}
```

## 2.6 Template

```csharp
public sealed class BotTemplate : Entity<Guid>
{
  public Guid WorkspaceId { get; private set; }
  public string Name { get; private set; } = string.Empty;
  public string Description { get; private set; } = string.Empty;
  public FlowGraph GraphSnapshot { get; private set; } = default!;
  public BotTheme ThemeSnapshot { get; private set; } = default!;
  public bool IsPublic { get; private set; }
}
```

## 2.7 Colaboração

```csharp
public sealed class BotCollaborator : Entity<Guid>
{
  public Guid BotId { get; private set; }
  public Guid UserId { get; private set; }
  public CollaborationType Permission { get; private set; }

  private BotCollaborator() { }

  public static BotCollaborator Create(Guid botId, Guid userId, CollaborationType permission)
    => new() { Id = Guid.NewGuid(), BotId = botId, UserId = userId, Permission = permission };

  public void ChangePermission(CollaborationType permission) => Permission = permission;
}
```

---

## 3) Validação (RF-026)

## 3.1 Tipos de issue

```csharp
public sealed record ValidationIssue(
  string Code,
  ValidationSeverity Severity,
  string Message,
  string? NodeId,
  string? EdgeId);

public sealed record BotValidationResult(IReadOnlyList<ValidationIssue> Issues)
{
  public bool HasErrors => Issues.Any(issue => issue.Severity == ValidationSeverity.Error);
}
```

## 3.2 Regras de validação obrigatórias

1. Existe nó inicial (`StartNodeId` válido).
2. Todos os `source/target` de arestas referenciam nós existentes.
3. Não há nó órfão inacessível a partir do start (exceto nós explicitamente desativados).
4. `End` obrigatório em pelo menos um caminho.
5. Blocos de input devem possuir variável de saída configurada.
6. Blocos de integração devem conter configurações mínimas.
7. Não pode haver ciclo infinito sem condição de parada (warning ou error, configurável).
8. Campos obrigatórios por tipo de bloco:
   - `TextBubble`: `text`
   - `Webhook/HttpRequest`: `url`, `method`
   - `OpenAi`: `model`, `prompt`
   - `StripePayment`: `priceId`
9. Limites de plano (quantidade de blocos/integrações avançadas) validados antes da publicação.

## 3.3 Interface e serviço

```csharp
public interface IFlowValidator
{
  BotValidationResult Validate(FlowGraph graph, WorkspacePlan workspacePlan);
}

public sealed class FlowValidator : IFlowValidator
{
  public BotValidationResult Validate(FlowGraph graph, WorkspacePlan workspacePlan)
  {
    var issues = new List<ValidationIssue>();
    // Implementar regras da seção 3.2
    return new BotValidationResult(issues);
  }
}
```

---

## 4) Eventos de domínio

```csharp
public interface IDomainEvent { }

public sealed record BotCreatedDomainEvent(Guid BotId, Guid WorkspaceId, Guid ActorUserId) : IDomainEvent;
public sealed record BotCreatedFromTemplateDomainEvent(Guid BotId, Guid TemplateId, Guid ActorUserId) : IDomainEvent;
public sealed record BotUpdatedDomainEvent(Guid BotId) : IDomainEvent;
public sealed record BotDraftUpdatedDomainEvent(Guid BotId, Guid DraftVersionId, Guid ActorUserId) : IDomainEvent;
public sealed record BotThemeUpdatedDomainEvent(Guid BotId, Guid DraftVersionId, Guid ActorUserId) : IDomainEvent;
public sealed record BotPublishedDomainEvent(Guid BotId, Guid PublishedVersionId, Guid ActorUserId) : IDomainEvent;
public sealed record BotCollaboratorAddedDomainEvent(Guid BotId, Guid TargetUserId, CollaborationType Permission, Guid ActorUserId) : IDomainEvent;
public sealed record BotCollaboratorRemovedDomainEvent(Guid BotId, Guid TargetUserId, Guid ActorUserId) : IDomainEvent;
public sealed record BotCollaboratorPermissionChangedDomainEvent(Guid BotId, Guid TargetUserId, CollaborationType Permission, Guid ActorUserId) : IDomainEvent;
public sealed record BotValidationFailedDomainEvent(Guid BotId, Guid DraftVersionId, IReadOnlyList<ValidationIssue> Issues) : IDomainEvent;
```

---

## 5) Application layer (DTOs, use cases, interfaces)

## 5.1 DTOs

```csharp
public sealed record BotSummaryDto(Guid Id, string Name, string PublicSlug, BotStatus Status, Guid CurrentDraftVersionId, Guid? PublishedVersionId);

public sealed record FlowNodeDto(string Id, FlowNodeType Type, string ConfigJson, double PositionX, double PositionY);
public sealed record FlowEdgeDto(string Id, string SourceNodeId, string TargetNodeId, EdgeConditionDto Condition);
public sealed record EdgeConditionDto(EdgeConditionOperator Operator, string? LeftValue, string? RightValue);

public sealed record BotGraphDto(string StartNodeId, IReadOnlyList<FlowNodeDto> Nodes, IReadOnlyList<FlowEdgeDto> Edges, long Revision);

public sealed record BotThemeDto(ThemeMode Mode, string FontFamily, string PrimaryColor, string BackgroundColor, int BorderRadius, string? CustomCss);

public sealed record BotBuilderStateDto(
  BotSummaryDto Bot,
  BotGraphDto DraftGraph,
  BotThemeDto DraftTheme,
  IReadOnlyList<BotCollaboratorDto> Collaborators,
  IReadOnlyList<ValidationIssueDto> LastValidationIssues);

public sealed record BotCollaboratorDto(Guid UserId, string UserEmail, CollaborationType Permission);
public sealed record ValidationIssueDto(string Code, ValidationSeverity Severity, string Message, string? NodeId, string? EdgeId);

public sealed record BotVersionDto(Guid Id, string Tag, BotVersionStatus Status, DateTime CreatedAtUtc, DateTime? PublishedAtUtc, long Revision);
```

## 5.2 Commands

- `CreateBotFromScratchCommand`
- `CreateBotFromTemplateCommand`
- `RenameBotCommand`
- `UpdateBotDraftGraphCommand`
- `UpdateBotDraftThemeCommand`
- `ValidateBotDraftCommand`
- `PublishBotDraftCommand`
- `AddBotCollaboratorCommand`
- `UpdateBotCollaboratorPermissionCommand`
- `RemoveBotCollaboratorCommand`

## 5.3 Queries

- `GetBotBuilderStateQuery`
- `ListWorkspaceBotsQuery`
- `ListBotVersionsQuery`
- `GetBotVersionSnapshotQuery`
- `GetTemplateCatalogQuery`

## 5.4 Ports

```csharp
public interface IBotRepository
{
  Task<Bot?> FindByIdAsync(Guid botId, CancellationToken ct);
  Task<IReadOnlyList<Bot>> ListByWorkspaceIdAsync(Guid workspaceId, CancellationToken ct);
  Task AddAsync(Bot bot, CancellationToken ct);
}

public interface IBotTemplateRepository
{
  Task<BotTemplate?> FindByIdAsync(Guid templateId, CancellationToken ct);
  Task<IReadOnlyList<BotTemplate>> ListAvailableAsync(Guid workspaceId, CancellationToken ct);
}

public interface IBotRealtimePublisher
{
  Task PublishBuilderStateChangedAsync(Guid workspaceId, Guid botId, BotBuilderStateDto state, CancellationToken ct);
}

public interface IBotPolicyService
{
  Task EnsureCanReadAsync(Guid actorUserId, Guid botId, CancellationToken ct);
  Task EnsureCanEditAsync(Guid actorUserId, Guid botId, CancellationToken ct);
  Task EnsureCanAdminAsync(Guid actorUserId, Guid botId, CancellationToken ct);
}

public interface IUnitOfWork
{
  Task SaveChangesAsync(CancellationToken ct);
}
```

## 5.5 Exemplo de handler

```csharp
public sealed record PublishBotDraftCommand(Guid ActorUserId, Guid BotId) : IRequest<BotVersionDto>;

public sealed class PublishBotDraftCommandHandler(
  IBotRepository botRepository,
  IFlowValidator flowValidator,
  IWorkspaceRepository workspaceRepository,
  IUnitOfWork unitOfWork) : IRequestHandler<PublishBotDraftCommand, BotVersionDto>
{
  public async Task<BotVersionDto> Handle(PublishBotDraftCommand request, CancellationToken cancellationToken)
  {
    var bot = await botRepository.FindByIdAsync(request.BotId, cancellationToken) ?? throw new InvalidOperationException("Bot not found");
    var workspace = await workspaceRepository.FindByIdAsync(bot.WorkspaceId, cancellationToken) ?? throw new InvalidOperationException("Workspace not found");

    var draftVersion = bot.GetDraftVersion();
    var validationResult = flowValidator.Validate(draftVersion.Graph, workspace.Plan);

    if (validationResult.HasErrors)
    {
      bot.Raise(new BotValidationFailedDomainEvent(bot.Id, draftVersion.Id, validationResult.Issues));
      throw new InvalidOperationException("Cannot publish invalid draft");
    }

    var publishedVersion = bot.Publish(request.ActorUserId, validationResult);

    await unitOfWork.SaveChangesAsync(cancellationToken);

    return new BotVersionDto(
      publishedVersion.Id,
      publishedVersion.Tag,
      publishedVersion.Status,
      publishedVersion.CreatedAtUtc,
      publishedVersion.PublishedAtUtc,
      publishedVersion.Revision);
  }
}
```

---

## 6) API Controllers (REST + realtime)

## 6.1 Endpoints

### Bots
- `GET /api/v1/workspaces/{workspaceId}/bots`
- `POST /api/v1/workspaces/{workspaceId}/bots/from-scratch`
- `POST /api/v1/workspaces/{workspaceId}/bots/from-template`
- `PATCH /api/v1/bots/{botId}`

### Builder
- `GET /api/v1/bots/{botId}/builder-state`
- `PUT /api/v1/bots/{botId}/draft/graph`
- `PUT /api/v1/bots/{botId}/draft/theme`
- `POST /api/v1/bots/{botId}/draft/validate`
- `POST /api/v1/bots/{botId}/draft/publish`

### Versões
- `GET /api/v1/bots/{botId}/versions`
- `GET /api/v1/bots/{botId}/versions/{versionId}`

### Colaboração
- `GET /api/v1/bots/{botId}/collaborators`
- `POST /api/v1/bots/{botId}/collaborators`
- `PATCH /api/v1/bots/{botId}/collaborators/{targetUserId}`
- `DELETE /api/v1/bots/{botId}/collaborators/{targetUserId}`

### Templates
- `GET /api/v1/workspaces/{workspaceId}/templates`

## 6.2 Hub realtime

- `Hub`: `/hubs/builder`
- eventos servidor → cliente:
  - `builder.graph.updated`
  - `builder.theme.updated`
  - `builder.validation.updated`
  - `builder.collaborators.updated`
  - `builder.version.published`
- eventos cliente → servidor:
  - `builder.presence.join`
  - `builder.presence.leave`
  - `builder.cursor.move`

---

## 7) Persistência (EF Core)

## 7.1 Tabelas

- `bots`
  - `id`, `workspace_id`, `name`, `icon`, `public_slug`, `status`, `visibility`, `current_draft_version_id`, `published_version_id`, `created_at`, `updated_at`
- `bot_versions`
  - `id`, `bot_id`, `tag`, `status`, `revision`, `graph_json`, `theme_json`, `created_by_user_id`, `created_at`, `published_at`
- `bot_collaborators`
  - `id`, `bot_id`, `user_id`, `permission`, `created_at`
- `bot_templates`
  - `id`, `workspace_id`, `name`, `description`, `graph_json`, `theme_json`, `is_public`
- `bot_validation_runs`
  - `id`, `bot_id`, `version_id`, `issues_json`, `created_by_user_id`, `created_at`

## 7.2 Índices e constraints

- `bots(workspace_id, updated_at desc)`
- `bots(public_slug)` unique
- `bot_versions(bot_id, created_at desc)`
- `bot_collaborators(bot_id, user_id)` unique
- FK consistente para `published_version_id` e `current_draft_version_id`

## 7.3 Concorrência

- Usar `revision` em `bot_versions` para controle otimista.
- `UpdateBotDraftGraphCommand` deve receber `expectedRevision`.
- Em conflito, retornar `409 Conflict` com payload da versão mais recente.

---

## 8) Frontend Nuxt 4 (implementação completa)

## 8.1 Entities

```ts
export type BuilderBotEntity = {
  id: string
  workspaceId: string
  name: string
  publicSlug: string
  status: 'Draft' | 'Published' | 'Archived'
  currentDraftVersionId: string
  publishedVersionId: string | null
}

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

export type BuilderNodeEntity = {
  id: string
  type: BuilderNodeType
  configJson: string
  positionX: number
  positionY: number
}

export type BuilderEdgeEntity = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  condition: {
    operator:
      | 'Always'
      | 'Equals'
      | 'NotEquals'
      | 'Contains'
      | 'GreaterThan'
      | 'LessThan'
      | 'IsEmpty'
      | 'IsNotEmpty'
    leftValue: string | null
    rightValue: string | null
  }
}

export type BuilderGraphEntity = {
  startNodeId: string
  nodes: BuilderNodeEntity[]
  edges: BuilderEdgeEntity[]
  revision: number
}

export type BuilderThemeEntity = {
  mode: 'Light' | 'Dark' | 'Auto'
  fontFamily: string
  primaryColor: string
  backgroundColor: string
  borderRadius: number
  customCss: string | null
}

export type BuilderValidationIssueEntity = {
  code: string
  severity: 'Info' | 'Warning' | 'Error'
  message: string
  nodeId: string | null
  edgeId: string | null
}

export type BuilderCollaboratorEntity = {
  userId: string
  userEmail: string
  permission: 'Read' | 'Edit' | 'Admin'
}
```

## 8.2 Interfaces

```ts
export interface IBuilderService {
  listWorkspaceBots(workspaceId: string): Promise<BuilderBotEntity[]>
  createFromScratch(workspaceId: string, payload: { name: string; publicSlug: string }): Promise<BuilderBotEntity>
  createFromTemplate(workspaceId: string, payload: { name: string; publicSlug: string; templateId: string }): Promise<BuilderBotEntity>
  getBuilderState(botId: string): Promise<{
    bot: BuilderBotEntity
    graph: BuilderGraphEntity
    theme: BuilderThemeEntity
    collaborators: BuilderCollaboratorEntity[]
    validationIssues: BuilderValidationIssueEntity[]
  }>
  updateGraph(botId: string, graph: BuilderGraphEntity): Promise<void>
  updateTheme(botId: string, theme: BuilderThemeEntity): Promise<void>
  validateDraft(botId: string): Promise<BuilderValidationIssueEntity[]>
  publishDraft(botId: string): Promise<{ publishedVersionId: string }>
  listVersions(botId: string): Promise<{ id: string; tag: string; status: string; createdAtUtc: string; publishedAtUtc: string | null }[]>
  addCollaborator(botId: string, payload: { userEmail: string; permission: 'Read' | 'Edit' | 'Admin' }): Promise<void>
  updateCollaboratorPermission(botId: string, userId: string, permission: 'Read' | 'Edit' | 'Admin'): Promise<void>
  removeCollaborator(botId: string, userId: string): Promise<void>
}

export interface IBuilderRealtimeService {
  connect(workspaceId: string, botId: string): Promise<void>
  disconnect(): Promise<void>
  onGraphUpdated(callback: (graph: BuilderGraphEntity) => void): void
  onThemeUpdated(callback: (theme: BuilderThemeEntity) => void): void
  onValidationUpdated(callback: (issues: BuilderValidationIssueEntity[]) => void): void
  onCollaboratorsUpdated(callback: (collaborators: BuilderCollaboratorEntity[]) => void): void
  onVersionPublished(callback: (publishedVersionId: string) => void): void
}
```

## 8.3 Services

- `BuilderHttpService` para REST.
- `BuilderSignalRService` para colaboração/presença.
- `TemplateCatalogService` para RF-020 com templates.

## 8.4 Stores Pinia

### `useBuilderStore`
- estado:
  - `currentBot`
  - `graph`
  - `theme`
  - `validationIssues`
  - `versions`
  - `isPublishing`
  - `isSavingGraph`
- ações:
  - `loadBuilderState`
  - `createBotFromScratch`
  - `createBotFromTemplate`
  - `upsertNode`
  - `removeNode`
  - `upsertEdge`
  - `removeEdge`
  - `saveGraph`
  - `saveTheme`
  - `validateDraft`
  - `publishDraft`

### `useBuilderCollaborationStore`
- estado:
  - `onlineUsers`
  - `cursorByUserId`
  - `collaborators`
- ações:
  - `connect`
  - `disconnect`
  - `addCollaborator`
  - `changeCollaboratorPermission`
  - `removeCollaborator`

## 8.5 Components

### RF-020 (criação)
- `BuilderCreateBotModal.vue`
- `BuilderTemplateSelector.vue`
- `TemplateCard.vue`

### RF-021 (modelagem)
- `BuilderCanvas.vue`
- `BuilderNodeRenderer.vue`
- `BuilderEdgeRenderer.vue`
- `BuilderNodePalette.vue`
- `BuilderInspectorPanel.vue`
- `BuilderMiniMap.vue`

### RF-022 (versionamento)
- `BuilderVersionBadge.vue`
- `BuilderVersionsDrawer.vue`
- `BuilderPublishDialog.vue`

### RF-023 (preview)
- `BuilderLivePreviewPanel.vue`
- `BuilderPreviewDeviceToggle.vue`
- `BuilderPreviewSessionLog.vue`

### RF-024 (tema)
- `BuilderThemeEditor.vue`
- `BuilderThemeColorPicker.vue`
- `BuilderThemeTypographyEditor.vue`
- `BuilderThemeCssEditor.vue`

### RF-025 (colaboração)
- `BuilderCollaboratorsPanel.vue`
- `BuilderInviteCollaboratorDialog.vue`
- `BuilderPresenceAvatars.vue`
- `BuilderRemoteCursorLayer.vue`

### RF-026 (validação)
- `BuilderValidationPanel.vue`
- `BuilderValidationIssueItem.vue`
- `BuilderPublishBlockerAlert.vue`

## 8.6 Pages

- `pages/workspaces/[workspaceId]/bots/index.vue`
- `pages/workspaces/[workspaceId]/bots/create.vue`
- `pages/workspaces/[workspaceId]/bots/[botId]/builder.vue`
- `pages/workspaces/[workspaceId]/bots/[botId]/versions.vue`
- `pages/workspaces/[workspaceId]/bots/[botId]/theme.vue`

## 8.7 Fluxo de UI por requisito

### RF-020
1. Usuário abre `bots/create`.
2. Escolhe “Do zero” ou template.
3. Front chama endpoint correspondente.
4. Redireciona para `/builder`.

### RF-021
1. Usuário arrasta bloco da paleta.
2. `builderStore.upsertNode` aplica mudança local.
3. `saveGraph` envia grafo completo + revisão.
4. Backend valida consistência estrutural e salva.

### RF-022
1. Todo bot possui draft ativo.
2. Publicar converte draft em versão publicada.
3. Backend cria novo draft automaticamente.
4. UI atualiza badge e histórico.

### RF-023
1. Painel de preview observa estado atual do draft.
2. Alterações no grafo/tema atualizam preview em tempo real.
3. Preview permite reset de sessão de teste.

### RF-024
1. Usuário altera tokens visuais (cores/fontes/radius/CSS).
2. `saveTheme` persiste draft.
3. Preview aplica tema imediatamente.

### RF-025
1. Admin adiciona colaborador.
2. Permissões Read/Edit/Admin afetam ações habilitadas.
3. Presença e cursores remotos via SignalR.

### RF-026
1. Usuário aciona validar/publicar.
2. Backend retorna issues.
3. Erros bloqueiam publish.
4. Warnings podem publicar com confirmação explícita.

---

## 9) Sequência de implementação (roadmap)

### Sprint A — Core Builder (RF-020, RF-021)
- Entidades de bot/grafo/tema.
- Endpoints de criação e update de grafo.
- Canvas + paleta + inspector.

### Sprint B — Versionamento + validação (RF-022, RF-026)
- Publicação com snapshot.
- Motor de validação.
- UI de issues + bloqueio de publish.

### Sprint C — Preview + tema (RF-023, RF-024)
- Painel de preview em tempo real.
- Editor de tema completo.

### Sprint D — Colaboração (RF-025)
- Colaboradores CRUD.
- Permissões por ação.
- Presença e cursor remoto.

---

## 10) Matriz de testes

## 10.1 Backend

- **RF-020**
  - criar bot vazio gera `start + bubble` padrão.
  - criar por template copia graph/theme.
- **RF-021**
  - salvar grafo válido persiste revisão.
  - salvar com revisão desatualizada retorna conflito.
- **RF-022**
  - publish cria versão publicada e novo draft.
- **RF-023**
  - atualização de draft publica evento realtime.
- **RF-024**
  - tema inválido (hex incorreto/CSS excedido) falha validação.
- **RF-025**
  - colaborador `Read` não edita.
  - colaborador `Edit` não publica.
  - colaborador `Admin` administra permissões.
- **RF-026**
  - nó órfão gera error.
  - grafo sem End gera error.
  - warning não bloqueia com override explícito.

## 10.2 Frontend (Playwright)

1. Criar bot do zero e abrir builder.
2. Criar bot por template.
3. Editar fluxo (adicionar/remover nó/aresta) e salvar.
4. Visualizar conflito de revisão.
5. Validar draft e exibir issues.
6. Publicar com sucesso e ver nova versão.
7. Alterar tema e validar preview.
8. Convidar colaborador e checar restrições de UI.

---

## 11) Critérios de aceite por requisito

- **RF-020**: usuário consegue criar bot do zero e por template em menos de 3 cliques.
- **RF-021**: mudanças de grafo são persistidas com controle de concorrência.
- **RF-022**: histórico de versão publicado/draft é auditável.
- **RF-023**: preview reflete alterações em até 500ms após save local.
- **RF-024**: tema visual persistido e aplicado no preview/runtime.
- **RF-025**: permissões impedem ações indevidas no backend e frontend.
- **RF-026**: publicação bloqueada quando houver erro de validação.
