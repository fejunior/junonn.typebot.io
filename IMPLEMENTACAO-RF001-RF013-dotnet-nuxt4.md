# Implementação Concreta — RF-001 até RF-013 (.NET + Nuxt 4)

> Escopo deste documento: implementação prática dos requisitos funcionais **RF-001..RF-013** (Identidade/Acesso + Workspaces), com classes C#, enums, eventos, controllers, DTOs, use cases e, no frontend Nuxt 4, entities, services, interfaces, components, pages e fluxo.

---

## 1) Escopo dos requisitos

### Identidade e acesso
- RF-001: Registrar usuário por email/senha ou SSO (Google/GitHub).
- RF-002: Login, refresh token e logout global.
- RF-003: Recuperação de senha via token com expiração.
- RF-004: Multi-workspace por usuário.
- RF-005: Convite de membros por email com papel.
- RF-006: RBAC por workspace e por bot.

### Workspaces
- RF-010: Criar/editar workspace.
- RF-011: Definir plano e limites de uso.
- RF-012: Domínio customizado para publicação.
- RF-013: Gestão de membros (owner/admin/member/billing).

---

## 2) Backend (.NET 8, Clean Architecture)

## 2.1 Estrutura de projetos

```txt
src/
  TypebotClone.Domain/
    Common/
    Identity/
    Workspaces/
    Bots/
  TypebotClone.Application/
    Abstractions/
    Identity/
      Commands/
      Queries/
      DTOs/
    Workspaces/
      Commands/
      Queries/
      DTOs/
  TypebotClone.Infrastructure/
    Persistence/
    Auth/
    Email/
    Integrations/
  TypebotClone.Api/
    Controllers/
    Contracts/
    Policies/
```

## 2.2 Domain — classes concretas

### 2.2.1 Base

```csharp
public abstract class Entity<TId>
{
  public TId Id { get; protected set; } = default!;
}

public abstract class AuditableEntity<TId> : Entity<TId>
{
  public DateTime CreatedAtUtc { get; protected set; } = DateTime.UtcNow;
  public DateTime UpdatedAtUtc { get; protected set; } = DateTime.UtcNow;
  public void Touch() => UpdatedAtUtc = DateTime.UtcNow;
}

public abstract class AggregateRoot<TId> : AuditableEntity<TId>
{
  private readonly List<IDomainEvent> _domainEvents = [];
  public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents;
  protected void Raise(IDomainEvent domainEvent) => _domainEvents.Add(domainEvent);
  public void ClearEvents() => _domainEvents.Clear();
}
```

### 2.2.2 Enums

```csharp
public enum AuthProviderType { Local = 1, Google = 2, GitHub = 3 }
public enum UserStatus { PendingVerification = 1, Active = 2, Suspended = 3, Deleted = 4 }
public enum TokenType { EmailVerification = 1, PasswordReset = 2, Refresh = 3 }

public enum WorkspaceRole { Owner = 1, Admin = 2, Member = 3, Billing = 4 }
public enum WorkspacePlan { Free = 1, Starter = 2, Pro = 3, Enterprise = 4 }
public enum InvitationStatus { Pending = 1, Accepted = 2, Expired = 3, Revoked = 4 }
public enum DomainVerificationStatus { Pending = 1, Verified = 2, Failed = 3 }

public enum BotCollaborationType { Read = 1, Edit = 2, Admin = 3 }
```

### 2.2.3 Value Objects

```csharp
public sealed record Email(string Value)
{
  public static Email Create(string value)
  {
    if (string.IsNullOrWhiteSpace(value) || !value.Contains('@')) throw new ArgumentException("Invalid email");
    return new Email(value.Trim().ToLowerInvariant());
  }
}

public sealed record PasswordHash(string Value);
public sealed record WorkspaceSlug(string Value);
public sealed record CustomDomainName(string Value);
```

### 2.2.4 Identity aggregate

```csharp
public sealed class User : AggregateRoot<Guid>
{
  private readonly List<UserAuthProvider> _providers = [];
  private readonly List<RefreshToken> _refreshTokens = [];

  public Email Email { get; private set; } = default!;
  public string DisplayName { get; private set; } = string.Empty;
  public PasswordHash? PasswordHash { get; private set; }
  public UserStatus Status { get; private set; } = UserStatus.PendingVerification;
  public DateTime? EmailVerifiedAtUtc { get; private set; }

  public IReadOnlyCollection<UserAuthProvider> Providers => _providers;
  public IReadOnlyCollection<RefreshToken> RefreshTokens => _refreshTokens;

  private User() { }

  public static User CreateLocal(Email email, string displayName, PasswordHash passwordHash)
  {
    var user = new User
    {
      Id = Guid.NewGuid(),
      Email = email,
      DisplayName = displayName,
      PasswordHash = passwordHash,
      Status = UserStatus.PendingVerification
    };
    user._providers.Add(UserAuthProvider.Create(user.Id, AuthProviderType.Local, email.Value));
    user.Raise(new UserRegisteredDomainEvent(user.Id, email.Value, false));
    return user;
  }

  public static User CreateSso(Email email, string displayName, AuthProviderType provider, string providerSubject)
  {
    var user = new User
    {
      Id = Guid.NewGuid(),
      Email = email,
      DisplayName = displayName,
      Status = UserStatus.Active,
      EmailVerifiedAtUtc = DateTime.UtcNow
    };
    user._providers.Add(UserAuthProvider.Create(user.Id, provider, providerSubject));
    user.Raise(new UserRegisteredDomainEvent(user.Id, email.Value, true));
    return user;
  }

  public void VerifyEmail()
  {
    Status = UserStatus.Active;
    EmailVerifiedAtUtc = DateTime.UtcNow;
    Raise(new UserEmailVerifiedDomainEvent(Id));
  }

  public RefreshToken IssueRefreshToken(DateTime expiresAtUtc)
  {
    var token = RefreshToken.Create(Id, expiresAtUtc);
    _refreshTokens.Add(token);
    return token;
  }

  public void RevokeAllRefreshTokens(string reason)
  {
    foreach (var token in _refreshTokens.Where(token => !token.IsRevoked)) token.Revoke(reason);
    Raise(new UserLoggedOutEverywhereDomainEvent(Id, reason));
  }

  public void SetPassword(PasswordHash newPasswordHash)
  {
    PasswordHash = newPasswordHash;
    Touch();
  }
}

public sealed class UserAuthProvider : Entity<Guid>
{
  public Guid UserId { get; private set; }
  public AuthProviderType ProviderType { get; private set; }
  public string ProviderSubject { get; private set; } = string.Empty;

  private UserAuthProvider() { }

  public static UserAuthProvider Create(Guid userId, AuthProviderType providerType, string providerSubject) => new()
  {
    Id = Guid.NewGuid(),
    UserId = userId,
    ProviderType = providerType,
    ProviderSubject = providerSubject
  };
}

public sealed class RefreshToken : Entity<Guid>
{
  public Guid UserId { get; private set; }
  public string TokenHash { get; private set; } = string.Empty;
  public DateTime ExpiresAtUtc { get; private set; }
  public DateTime? RevokedAtUtc { get; private set; }
  public string? RevocationReason { get; private set; }
  public bool IsRevoked => RevokedAtUtc.HasValue;

  private RefreshToken() { }

  public static RefreshToken Create(Guid userId, DateTime expiresAtUtc)
  {
    return new RefreshToken
    {
      Id = Guid.NewGuid(),
      UserId = userId,
      TokenHash = Convert.ToBase64String(Guid.NewGuid().ToByteArray()),
      ExpiresAtUtc = expiresAtUtc
    };
  }

  public void Revoke(string reason)
  {
    if (IsRevoked) return;
    RevokedAtUtc = DateTime.UtcNow;
    RevocationReason = reason;
  }
}

public sealed class VerificationToken : Entity<Guid>
{
  public Guid UserId { get; private set; }
  public TokenType TokenType { get; private set; }
  public string TokenHash { get; private set; } = string.Empty;
  public DateTime ExpiresAtUtc { get; private set; }
  public DateTime? ConsumedAtUtc { get; private set; }

  public bool IsValid(DateTime nowUtc) => ConsumedAtUtc is null && ExpiresAtUtc > nowUtc;
  public void Consume() => ConsumedAtUtc = DateTime.UtcNow;
}
```

### 2.2.5 Workspace aggregate

```csharp
public sealed class Workspace : AggregateRoot<Guid>
{
  private readonly List<WorkspaceMember> _members = [];
  private readonly List<WorkspaceInvitation> _invitations = [];
  private readonly List<CustomDomain> _customDomains = [];

  public string Name { get; private set; } = string.Empty;
  public WorkspaceSlug Slug { get; private set; } = default!;
  public WorkspacePlan Plan { get; private set; } = WorkspacePlan.Free;
  public WorkspaceQuota Quota { get; private set; } = WorkspaceQuota.ForPlan(WorkspacePlan.Free);

  public IReadOnlyCollection<WorkspaceMember> Members => _members;
  public IReadOnlyCollection<WorkspaceInvitation> Invitations => _invitations;
  public IReadOnlyCollection<CustomDomain> CustomDomains => _customDomains;

  private Workspace() { }

  public static Workspace Create(string name, WorkspaceSlug slug, Guid ownerUserId)
  {
    var workspace = new Workspace
    {
      Id = Guid.NewGuid(),
      Name = name,
      Slug = slug
    };

    workspace._members.Add(WorkspaceMember.Create(workspace.Id, ownerUserId, WorkspaceRole.Owner));
    workspace.Raise(new WorkspaceCreatedDomainEvent(workspace.Id, ownerUserId));
    return workspace;
  }

  public void Rename(string newName)
  {
    Name = newName;
    Touch();
    Raise(new WorkspaceUpdatedDomainEvent(Id));
  }

  public WorkspaceInvitation InviteMember(Email email, WorkspaceRole role, Guid invitedByUserId, DateTime expiresAtUtc)
  {
    if (_members.All(m => m.UserId != invitedByUserId || (m.Role != WorkspaceRole.Owner && m.Role != WorkspaceRole.Admin)))
      throw new InvalidOperationException("Only owner/admin can invite members");

    var invitation = WorkspaceInvitation.Create(Id, email, role, invitedByUserId, expiresAtUtc);
    _invitations.Add(invitation);
    Raise(new WorkspaceMemberInvitedDomainEvent(Id, invitation.Id, email.Value, role));
    return invitation;
  }

  public void AcceptInvitation(Guid invitationId, Guid userId)
  {
    var invitation = _invitations.Single(x => x.Id == invitationId);
    invitation.Accept();
    if (_members.All(member => member.UserId != userId)) _members.Add(WorkspaceMember.Create(Id, userId, invitation.Role));
    Raise(new WorkspaceMemberJoinedDomainEvent(Id, userId, invitation.Role));
  }

  public void ChangeMemberRole(Guid actorUserId, Guid targetUserId, WorkspaceRole newRole)
  {
    var actor = _members.Single(x => x.UserId == actorUserId);
    if (actor.Role is not WorkspaceRole.Owner and not WorkspaceRole.Admin)
      throw new InvalidOperationException("Insufficient permission");

    var target = _members.Single(x => x.UserId == targetUserId);
    if (target.Role == WorkspaceRole.Owner)
      throw new InvalidOperationException("Owner role cannot be changed here");

    target.ChangeRole(newRole);
    Raise(new WorkspaceMemberRoleChangedDomainEvent(Id, targetUserId, newRole));
  }

  public void RemoveMember(Guid actorUserId, Guid targetUserId)
  {
    var actor = _members.Single(x => x.UserId == actorUserId);
    if (actor.Role is not WorkspaceRole.Owner and not WorkspaceRole.Admin)
      throw new InvalidOperationException("Insufficient permission");

    var target = _members.Single(x => x.UserId == targetUserId);
    if (target.Role == WorkspaceRole.Owner)
      throw new InvalidOperationException("Owner cannot be removed");

    _members.Remove(target);
    Raise(new WorkspaceMemberRemovedDomainEvent(Id, targetUserId));
  }

  public void SetPlan(Guid actorUserId, WorkspacePlan plan)
  {
    var actor = _members.Single(x => x.UserId == actorUserId);
    if (actor.Role != WorkspaceRole.Owner) throw new InvalidOperationException("Only owner can change plan");

    Plan = plan;
    Quota = WorkspaceQuota.ForPlan(plan);
    Raise(new WorkspacePlanChangedDomainEvent(Id, plan));
  }

  public void AddCustomDomain(CustomDomainName domainName)
  {
    if (_customDomains.Any(x => x.Name == domainName.Value)) return;
    _customDomains.Add(CustomDomain.Create(Id, domainName));
    Raise(new WorkspaceCustomDomainAddedDomainEvent(Id, domainName.Value));
  }
}

public sealed class WorkspaceMember : Entity<Guid>
{
  public Guid WorkspaceId { get; private set; }
  public Guid UserId { get; private set; }
  public WorkspaceRole Role { get; private set; }

  private WorkspaceMember() { }

  public static WorkspaceMember Create(Guid workspaceId, Guid userId, WorkspaceRole role) => new()
  {
    Id = Guid.NewGuid(),
    WorkspaceId = workspaceId,
    UserId = userId,
    Role = role
  };

  public void ChangeRole(WorkspaceRole newRole) => Role = newRole;
}

public sealed class WorkspaceInvitation : Entity<Guid>
{
  public Guid WorkspaceId { get; private set; }
  public Email Email { get; private set; } = default!;
  public WorkspaceRole Role { get; private set; }
  public Guid InvitedByUserId { get; private set; }
  public InvitationStatus Status { get; private set; }
  public DateTime ExpiresAtUtc { get; private set; }

  private WorkspaceInvitation() { }

  public static WorkspaceInvitation Create(Guid workspaceId, Email email, WorkspaceRole role, Guid invitedByUserId, DateTime expiresAtUtc)
    => new()
    {
      Id = Guid.NewGuid(),
      WorkspaceId = workspaceId,
      Email = email,
      Role = role,
      InvitedByUserId = invitedByUserId,
      Status = InvitationStatus.Pending,
      ExpiresAtUtc = expiresAtUtc
    };

  public void Accept()
  {
    if (Status != InvitationStatus.Pending || DateTime.UtcNow > ExpiresAtUtc) throw new InvalidOperationException("Invitation invalid");
    Status = InvitationStatus.Accepted;
  }
}

public sealed class CustomDomain : Entity<Guid>
{
  public Guid WorkspaceId { get; private set; }
  public string Name { get; private set; } = string.Empty;
  public DomainVerificationStatus VerificationStatus { get; private set; } = DomainVerificationStatus.Pending;

  private CustomDomain() { }

  public static CustomDomain Create(Guid workspaceId, CustomDomainName domainName) => new()
  {
    Id = Guid.NewGuid(),
    WorkspaceId = workspaceId,
    Name = domainName.Value,
    VerificationStatus = DomainVerificationStatus.Pending
  };

  public void MarkVerified() => VerificationStatus = DomainVerificationStatus.Verified;
  public void MarkFailed() => VerificationStatus = DomainVerificationStatus.Failed;
}

public sealed record WorkspaceQuota(int BotsLimit, int ResponsesPerMonthLimit, int MembersLimit)
{
  public static WorkspaceQuota ForPlan(WorkspacePlan plan) => plan switch
  {
    WorkspacePlan.Free => new WorkspaceQuota(3, 100, 2),
    WorkspacePlan.Starter => new WorkspaceQuota(20, 5000, 5),
    WorkspacePlan.Pro => new WorkspaceQuota(100, 50000, 25),
    WorkspacePlan.Enterprise => new WorkspaceQuota(int.MaxValue, int.MaxValue, int.MaxValue),
    _ => new WorkspaceQuota(3, 100, 2)
  };
}
```

## 2.3 Domain events (RF-001..RF-013)

```csharp
public interface IDomainEvent { }

public sealed record UserRegisteredDomainEvent(Guid UserId, string Email, bool IsSso) : IDomainEvent;
public sealed record UserEmailVerifiedDomainEvent(Guid UserId) : IDomainEvent;
public sealed record UserLoggedInDomainEvent(Guid UserId, Guid SessionId) : IDomainEvent;
public sealed record UserLoggedOutEverywhereDomainEvent(Guid UserId, string Reason) : IDomainEvent;
public sealed record PasswordResetRequestedDomainEvent(Guid UserId, string Email) : IDomainEvent;
public sealed record PasswordResetCompletedDomainEvent(Guid UserId) : IDomainEvent;

public sealed record WorkspaceCreatedDomainEvent(Guid WorkspaceId, Guid OwnerUserId) : IDomainEvent;
public sealed record WorkspaceUpdatedDomainEvent(Guid WorkspaceId) : IDomainEvent;
public sealed record WorkspaceMemberInvitedDomainEvent(Guid WorkspaceId, Guid InvitationId, string Email, WorkspaceRole Role) : IDomainEvent;
public sealed record WorkspaceMemberJoinedDomainEvent(Guid WorkspaceId, Guid UserId, WorkspaceRole Role) : IDomainEvent;
public sealed record WorkspaceMemberRoleChangedDomainEvent(Guid WorkspaceId, Guid UserId, WorkspaceRole NewRole) : IDomainEvent;
public sealed record WorkspaceMemberRemovedDomainEvent(Guid WorkspaceId, Guid UserId) : IDomainEvent;
public sealed record WorkspacePlanChangedDomainEvent(Guid WorkspaceId, WorkspacePlan Plan) : IDomainEvent;
public sealed record WorkspaceCustomDomainAddedDomainEvent(Guid WorkspaceId, string Domain) : IDomainEvent;
```

## 2.4 Application layer — DTOs

```csharp
public sealed record AuthTokensDto(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc);
public sealed record UserDto(Guid Id, string Email, string DisplayName, UserStatus Status);

public sealed record WorkspaceDto(Guid Id, string Name, string Slug, WorkspacePlan Plan, WorkspaceQuotaDto Quota);
public sealed record WorkspaceQuotaDto(int BotsLimit, int ResponsesPerMonthLimit, int MembersLimit);
public sealed record WorkspaceMemberDto(Guid UserId, string Email, string DisplayName, WorkspaceRole Role);
public sealed record WorkspaceInvitationDto(Guid Id, string Email, WorkspaceRole Role, InvitationStatus Status, DateTime ExpiresAtUtc);
public sealed record CustomDomainDto(Guid Id, string Name, DomainVerificationStatus VerificationStatus);
```

## 2.5 Commands/Queries e handlers (use cases)

### Identidade
- `RegisterWithPasswordCommand`
- `RegisterWithSsoCommand`
- `LoginCommand`
- `RefreshTokenCommand`
- `LogoutAllSessionsCommand`
- `RequestPasswordResetCommand`
- `ResetPasswordCommand`
- `VerifyEmailCommand`

### Workspaces
- `CreateWorkspaceCommand`
- `UpdateWorkspaceCommand`
- `ListUserWorkspacesQuery`
- `InviteWorkspaceMemberCommand`
- `AcceptWorkspaceInvitationCommand`
- `UpdateWorkspaceMemberRoleCommand`
- `RemoveWorkspaceMemberCommand`
- `SetWorkspacePlanCommand`
- `AddWorkspaceCustomDomainCommand`

### Exemplo de handler concreto

```csharp
public sealed record CreateWorkspaceCommand(Guid ActorUserId, string Name, string Slug) : IRequest<WorkspaceDto>;

public sealed class CreateWorkspaceCommandHandler(
  IWorkspaceRepository workspaceRepository,
  IUnitOfWork unitOfWork) : IRequestHandler<CreateWorkspaceCommand, WorkspaceDto>
{
  public async Task<WorkspaceDto> Handle(CreateWorkspaceCommand request, CancellationToken cancellationToken)
  {
    var workspace = Workspace.Create(request.Name, new WorkspaceSlug(request.Slug), request.ActorUserId);
    await workspaceRepository.AddAsync(workspace, cancellationToken);
    await unitOfWork.SaveChangesAsync(cancellationToken);

    return new WorkspaceDto(
      workspace.Id,
      workspace.Name,
      workspace.Slug.Value,
      workspace.Plan,
      new WorkspaceQuotaDto(workspace.Quota.BotsLimit, workspace.Quota.ResponsesPerMonthLimit, workspace.Quota.MembersLimit));
  }
}
```

## 2.6 Interfaces (ports)

```csharp
public interface IUserRepository
{
  Task<User?> FindByEmailAsync(string email, CancellationToken ct);
  Task<User?> FindByIdAsync(Guid id, CancellationToken ct);
  Task AddAsync(User user, CancellationToken ct);
}

public interface IWorkspaceRepository
{
  Task<Workspace?> FindByIdAsync(Guid id, CancellationToken ct);
  Task<IReadOnlyList<Workspace>> ListByUserIdAsync(Guid userId, CancellationToken ct);
  Task AddAsync(Workspace workspace, CancellationToken ct);
}

public interface ITokenService
{
  string CreateAccessToken(User user, IEnumerable<(Guid WorkspaceId, WorkspaceRole Role)> memberships);
  string HashToken(string token);
}

public interface IPasswordHasher
{
  PasswordHash Hash(string plainTextPassword);
  bool Verify(string plainTextPassword, PasswordHash hash);
}

public interface IEmailService
{
  Task SendVerificationEmailAsync(string to, string token, CancellationToken ct);
  Task SendPasswordResetEmailAsync(string to, string token, CancellationToken ct);
  Task SendWorkspaceInvitationAsync(string to, string workspaceName, string invitationToken, CancellationToken ct);
}

public interface ICustomDomainVerifier
{
  Task<DomainVerificationStatus> VerifyAsync(string domain, CancellationToken ct);
}

public interface IUnitOfWork
{
  Task SaveChangesAsync(CancellationToken ct);
}
```

## 2.7 Controllers (API)

### `AuthController`
- `POST /api/v1/auth/register/password`
- `POST /api/v1/auth/register/sso`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout-all`
- `POST /api/v1/auth/password/request-reset`
- `POST /api/v1/auth/password/reset`
- `POST /api/v1/auth/email/verify`

### `WorkspacesController`
- `GET /api/v1/workspaces`
- `POST /api/v1/workspaces`
- `PATCH /api/v1/workspaces/{workspaceId}`
- `POST /api/v1/workspaces/{workspaceId}/members/invite`
- `POST /api/v1/workspaces/invitations/{token}/accept`
- `PATCH /api/v1/workspaces/{workspaceId}/members/{userId}/role`
- `DELETE /api/v1/workspaces/{workspaceId}/members/{userId}`
- `PATCH /api/v1/workspaces/{workspaceId}/plan`
- `POST /api/v1/workspaces/{workspaceId}/domains`

### Exemplo de endpoint real

```csharp
[ApiController]
[Route("api/v1/workspaces")]
public sealed class WorkspacesController(IMediator mediator) : ControllerBase
{
  [HttpPost]
  [Authorize]
  public async Task<ActionResult<WorkspaceDto>> Create([FromBody] CreateWorkspaceRequest request, CancellationToken ct)
  {
    var actorUserId = User.GetUserId();
    var result = await mediator.Send(new CreateWorkspaceCommand(actorUserId, request.Name, request.Slug), ct);
    return Ok(result);
  }
}

public sealed record CreateWorkspaceRequest(string Name, string Slug);
```

## 2.8 RBAC policies (RF-006 e RF-013)

- `WorkspaceOwnerPolicy`
- `WorkspaceAdminOrOwnerPolicy`
- `WorkspaceMemberPolicy`
- `BotReadPolicy`
- `BotEditPolicy`

Implementação: `IAuthorizationHandler` consultando `workspace_members` e `bot_collaborators`.

## 2.9 Persistência (EF Core)

### Tabelas mínimas para RF-001..RF-013
- `users`
- `user_auth_providers`
- `refresh_tokens`
- `verification_tokens`
- `workspaces`
- `workspace_members`
- `workspace_invitations`
- `custom_domains`
- `bot_collaborators` (para RF-006 por bot)

### Constraints essenciais
- `users.email` unique
- `workspace_members(workspace_id,user_id)` unique
- `workspace_invitations.token_hash` unique
- `custom_domains.name` unique

---

## 3) Frontend (Nuxt 4)

## 3.1 Estrutura sugerida

```txt
frontend/
  app/
    entities/
    services/
    interfaces/
    stores/
    components/
    pages/
    middleware/
```

## 3.2 Entities (frontend)

```ts
export type UserEntity = {
  id: string
  email: string
  displayName: string
  status: 'PendingVerification' | 'Active' | 'Suspended' | 'Deleted'
}

export type WorkspaceRole = 'Owner' | 'Admin' | 'Member' | 'Billing'
export type WorkspacePlan = 'Free' | 'Starter' | 'Pro' | 'Enterprise'

export type WorkspaceEntity = {
  id: string
  name: string
  slug: string
  plan: WorkspacePlan
  quota: {
    botsLimit: number
    responsesPerMonthLimit: number
    membersLimit: number
  }
}

export type WorkspaceMemberEntity = {
  userId: string
  email: string
  displayName: string
  role: WorkspaceRole
}

export type WorkspaceInvitationEntity = {
  id: string
  email: string
  role: WorkspaceRole
  status: 'Pending' | 'Accepted' | 'Expired' | 'Revoked'
  expiresAtUtc: string
}
```

## 3.3 Interfaces (frontend)

```ts
export interface IAuthService {
  registerWithPassword(payload: RegisterPasswordPayload): Promise<void>
  registerWithSso(payload: RegisterSsoPayload): Promise<void>
  login(payload: LoginPayload): Promise<void>
  refresh(): Promise<void>
  logoutAll(): Promise<void>
  requestPasswordReset(payload: RequestPasswordResetPayload): Promise<void>
  resetPassword(payload: ResetPasswordPayload): Promise<void>
  verifyEmail(payload: VerifyEmailPayload): Promise<void>
}

export interface IWorkspaceService {
  listByCurrentUser(): Promise<WorkspaceEntity[]>
  create(payload: CreateWorkspacePayload): Promise<WorkspaceEntity>
  update(payload: UpdateWorkspacePayload): Promise<WorkspaceEntity>
  inviteMember(workspaceId: string, payload: InviteMemberPayload): Promise<void>
  acceptInvite(invitationToken: string): Promise<void>
  updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>
  removeMember(workspaceId: string, userId: string): Promise<void>
  setPlan(workspaceId: string, plan: WorkspacePlan): Promise<void>
  addCustomDomain(workspaceId: string, domain: string): Promise<void>
}
```

## 3.4 Services (implementações)

- `AuthHttpService` (usa `$fetch` para endpoints `/auth/*`)
- `WorkspaceHttpService` (usa `$fetch` para `/workspaces/*`)
- `SessionStorageService` (cache local do workspace atual)

### Exemplo

```ts
export class WorkspaceHttpService implements IWorkspaceService {
  async listByCurrentUser() {
    return await $fetch<WorkspaceEntity[]>('/api/v1/workspaces')
  }

  async create(payload: CreateWorkspacePayload) {
    return await $fetch<WorkspaceEntity>('/api/v1/workspaces', {
      method: 'POST',
      body: payload
    })
  }

  async setPlan(workspaceId: string, plan: WorkspacePlan) {
    await $fetch(`/api/v1/workspaces/${workspaceId}/plan`, {
      method: 'PATCH',
      body: { plan }
    })
  }

  async addCustomDomain(workspaceId: string, domain: string) {
    await $fetch(`/api/v1/workspaces/${workspaceId}/domains`, {
      method: 'POST',
      body: { domain }
    })
  }

  async inviteMember(workspaceId: string, payload: InviteMemberPayload) {
    await $fetch(`/api/v1/workspaces/${workspaceId}/members/invite`, {
      method: 'POST',
      body: payload
    })
  }

  async acceptInvite(invitationToken: string) {
    await $fetch(`/api/v1/workspaces/invitations/${invitationToken}/accept`, {
      method: 'POST'
    })
  }

  async update(payload: UpdateWorkspacePayload) {
    return await $fetch<WorkspaceEntity>(`/api/v1/workspaces/${payload.workspaceId}`, {
      method: 'PATCH',
      body: { name: payload.name }
    })
  }

  async updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole) {
    await $fetch(`/api/v1/workspaces/${workspaceId}/members/${userId}/role`, {
      method: 'PATCH',
      body: { role }
    })
  }

  async removeMember(workspaceId: string, userId: string) {
    await $fetch(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE'
    })
  }
}
```

## 3.5 Stores (Pinia)

- `useAuthStore`
  - estado: `currentUser`, `isAuthenticated`
  - ações: `register`, `login`, `refresh`, `logoutAll`, `requestReset`, `resetPassword`, `verifyEmail`
- `useWorkspaceStore`
  - estado: `workspaces`, `currentWorkspaceId`, `members`
  - ações: `loadWorkspaces`, `createWorkspace`, `updateWorkspace`, `inviteMember`, `acceptInvite`, `setPlan`, `addDomain`, `changeMemberRole`, `removeMember`

## 3.6 Components

### Auth
- `AuthRegisterForm.vue`
- `AuthSsoButtons.vue`
- `AuthLoginForm.vue`
- `AuthForgotPasswordForm.vue`
- `AuthResetPasswordForm.vue`
- `AuthVerifyEmailBanner.vue`

### Workspace
- `WorkspaceCreateModal.vue`
- `WorkspaceSwitcher.vue`
- `WorkspaceSettingsForm.vue`
- `WorkspacePlanSelector.vue`
- `WorkspaceQuotaCard.vue`
- `WorkspaceMembersTable.vue`
- `WorkspaceInviteMemberModal.vue`
- `WorkspaceCustomDomainForm.vue`

### RBAC/UI
- `CanAccess.vue` (render condicional por role/policy)

## 3.7 Pages (Nuxt)

- `pages/auth/register.vue`
- `pages/auth/login.vue`
- `pages/auth/forgot-password.vue`
- `pages/auth/reset-password.vue`
- `pages/auth/verify-email.vue`
- `pages/workspaces/index.vue`
- `pages/workspaces/create.vue`
- `pages/workspaces/[workspaceId]/settings/general.vue`
- `pages/workspaces/[workspaceId]/settings/members.vue`
- `pages/workspaces/[workspaceId]/settings/billing.vue`
- `pages/workspaces/[workspaceId]/settings/domains.vue`
- `pages/invitations/[token].vue`

## 3.8 Middleware

- `middleware/auth.global.ts` (redireciona se não autenticado)
- `middleware/workspace-role.ts` (role mínimo por rota)

---

## 4) Fluxo por requisito (RF-001..RF-013)

## RF-001 — Registro
1. Front: `AuthRegisterForm.vue` envia `POST /auth/register/password`.
2. App: `RegisterWithPasswordCommandHandler` cria `User` local, `VerificationToken`.
3. Infra: envia email de verificação.
4. SSO: `AuthSsoButtons.vue` inicia OAuth; callback chama `RegisterWithSsoCommand`.

## RF-002 — Login/refresh/logout global
1. `AuthLoginForm.vue` chama `POST /auth/login`.
2. Backend valida senha/provider e retorna `AuthTokensDto`.
3. Front agenda `refresh()` automático.
4. Logout global chama `POST /auth/logout-all` e revoga todos refresh tokens.

## RF-003 — Recuperação de senha
1. `forgot-password.vue` chama `POST /auth/password/request-reset`.
2. Backend gera `VerificationToken(TokenType.PasswordReset)` com expiração.
3. `reset-password.vue` chama `POST /auth/password/reset` com token + nova senha.
4. Backend consome token, atualiza senha e revoga sessões.

## RF-004 — Multi-workspace
1. Usuário autenticado chama `GET /workspaces`.
2. Backend retorna todos workspaces via `workspace_members`.
3. Front usa `WorkspaceSwitcher.vue` para alternar contexto.

## RF-005 — Convite de membros
1. Admin/Owner abre `WorkspaceInviteMemberModal.vue`.
2. Chama `POST /workspaces/{id}/members/invite` com email + role.
3. Backend cria `WorkspaceInvitation` com status `Pending` e envia email.
4. Convidado acessa `pages/invitations/[token].vue` e aceita convite.

## RF-006 — RBAC por workspace e bot
1. Cada endpoint protegido por policy (`WorkspaceMemberPolicy`, etc.).
2. Front utiliza `CanAccess.vue` para esconder ações não autorizadas.
3. Backend valida por membership/collaborator antes de executar command.

## RF-010 — Criar/editar workspace
1. `WorkspaceCreateModal.vue` chama `POST /workspaces`.
2. `WorkspaceSettingsForm.vue` chama `PATCH /workspaces/{id}`.
3. Backend cria/atualiza aggregate `Workspace`.

## RF-011 — Plano e limites
1. `WorkspacePlanSelector.vue` chama `PATCH /workspaces/{id}/plan`.
2. Apenas `Owner` permitido.
3. Backend atualiza `Workspace.Plan` + `Workspace.Quota`.

## RF-012 — Domínio customizado
1. `WorkspaceCustomDomainForm.vue` chama `POST /workspaces/{id}/domains`.
2. Backend adiciona `CustomDomain` com status `Pending`.
3. Job/verifier executa challenge DNS/CNAME e marca `Verified` ou `Failed`.

## RF-013 — Gestão de membros
1. `WorkspaceMembersTable.vue` lista membros.
2. Admin/Owner altera papel com `PATCH /members/{userId}/role`.
3. Admin/Owner remove membro com `DELETE /members/{userId}`.
4. Regras de proteção: owner não removível, troca de owner via caso de uso dedicado.

---

## 5) Ordem de implementação (sprint-ready)

1. **Sprint 1**: RF-001, RF-002, RF-003 (Auth end-to-end)
2. **Sprint 2**: RF-004, RF-010 (Workspace base + switcher)
3. **Sprint 3**: RF-005, RF-013 (Convites + gestão de membros)
4. **Sprint 4**: RF-011, RF-012, RF-006 (Plano/domínio/RBAC completo)

---

## 6) Critérios de pronto (Definition of Done)

- Endpoint + command handler + validação + teste unitário por use case.
- Teste de integração de persistência para fluxos críticos.
- Página frontend integrada e validada com estado Pinia.
- Telemetria mínima (logs + trace + erro estruturado) no fluxo.
- Documentação OpenAPI atualizada para cada endpoint.

---

## 7) Testes mínimos por requisito

- RF-001: registro local e SSO cria usuário válido.
- RF-002: login emite token, refresh renova, logout global revoga.
- RF-003: reset token expira corretamente.
- RF-004: usuário com N workspaces lista corretamente.
- RF-005: convite aceita somente email/token válido.
- RF-006: usuário sem role recebe 403.
- RF-010: owner cria e edita workspace.
- RF-011: apenas owner muda plano.
- RF-012: domínio muda de `Pending` para `Verified`.
- RF-013: admin altera role/remove membro não-owner.
