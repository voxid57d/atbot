import { auditSummary } from "./audit-summary";
import { clearSelection, type Destination } from "./navigation";
import { EmployeeVisibility } from "./employee-visibility";
import { Overview } from "./overview-ui";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError, currentLaunchData, setLocalLaunchData } from "./api";
import { t, type TextKey } from "./text";
import { can, formatMoney, permissions, type Identity } from "../shared/domain";
import "./style.css";
import { EmployeeAttendance, AdminAttendance } from "./attendance-ui";
import { RequestManager } from "./requests-ui";
import { ScheduleManager, TabletManager } from "./schedules-ui";
import { Reception } from "./reception";
import { Brand } from "./brand";
import { DisciplineScreen } from "./discipline-ui";
import { PayrollScreen, SalaryHistory } from "./payroll-ui";
import { SalaryReviewFlow } from "./salary-review-flow";
import { RoleDailyPay } from "./role-pay-ui";
import { TelegramMessages } from "./messages-ui";
import { DebtorsScreen } from "./debtors-ui";
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        ready: () => void;
        expand: () => void;
        isVersionAtLeast?: (version: string) => boolean;
        showScanQrPopup?: (
          params: { text: string },
          callback: (value: string) => boolean,
        ) => void;
        closeScanQrPopup?: () => void;
      };
    };
  }
}
type Employee = {
  id: string;
  user_id: string;
  full_name: string;
  telegram_id: string;
  access: Identity["access"];
  active: number;
  activation_date: string;
  deactivation_date: string | null;
  level_id: string | null;
  role_name: string | null;
  role_id: string | null;
  level_name: string | null;
  hourly_rate?: number | null;
};
type Role = { id: string; name: string; active: number };
type Level = Role & { role_id: string; hourly_rate?: number | null };
type Me = {
  user: Identity;
  employee: Employee | null;
  today: string;
  phase: number;
};
type AdminUser = {
  id: string;
  full_name: string;
  telegram_id: string;
  access: Identity["access"];
  active: number;
  permissions: Identity["permissions"];
};
type Audit = {
  id: string;
  actor_name: string;
  entity_name?: string;
  action: string;
  reason: string | null;
  created_at: number;
  before_json: string | null;
  after_json: string | null;
};
type Field = {
  key: string;
  label: TextKey;
  type?: "text" | "number" | "date" | "select" | "checkbox" | "permissions";
  options?: { value: string; label: string }[];
  initial?: string | number | boolean | string[];
  required?: boolean;
};
type Dialog = {
  title: string;
  help?: string;
  fields: Field[];
  path: string;
  method?: string;
  transform?: (values: Record<string, unknown>) => unknown;
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    attendance: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    myAttendance: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    requests: (
      <>
        <path d="M4 4h16v13H9l-5 4zM8 8h8M8 12h5" />
      </>
    ),
    reviews: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 3h6v3H9zM8 13l3 3 5-6" />
      </>
    ),
    myDiscipline: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M8 13l3 3 5-6" />
      </>
    ),
    schedules: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3" />
      </>
    ),
    payroll: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M6 9v6M18 9v6" />
      </>
    ),
    salaryHistory: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    tablets: (
      <>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M10 18h4M8 6h3v3H8zM14 6h2v3h-2zM8 12h3v3H8zM14 12h2v3h-2z" />
      </>
    ),
    employees: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" />
      </>
    ),
    roles: (
      <>
        <rect x="3" y="6" width="18" height="15" rx="2" />
        <path d="M8 6V3h8v3M3 12h18M10 12v3h4v-3" />
      </>
    ),
    access: (
      <>
        <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6" />
      </>
    ),
    audit: (
      <>
        <path d="M4 5v5h5M4 10a8 8 0 1 1 0 6M12 7v5l3 2" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
      </>
    ),
    today: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18M8 15l2.5 2.5L16 13" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    logout: (
      <>
        <path d="M9 4H4v16h5M12 12h9m-4-4 4 4-4 4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.profile}
    </svg>
  );
}
function App() {
  const [navigationVersion, setNavigationVersion] = useState(0);
  useEffect(() => {
    const navigate = (event: Event) => {
      const destination = (event as CustomEvent<Destination>).detail;
      setPage(destination.page);
      setNavigationVersion((v) => v + 1);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("workspace-navigate", navigate);
    return () => window.removeEventListener("workspace-navigate", navigate);
  }, []);
  const [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [page, setPage] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showDisabledEmployees, setShowDisabledEmployees] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]),
    [roles, setRoles] = useState<Role[]>([]),
    [levels, setLevels] = useState<Level[]>([]),
    [users, setUsers] = useState<AdminUser[]>([]),
    [events, setEvents] = useState<Audit[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [history, setHistory] = useState<{
      assignments: Record<string, unknown>[];
      rates: Record<string, unknown>[];
    } | null>(null);
  const [localData, setLocalData] = useState(""),
    [loginBusy, setLoginBusy] = useState(false);
  function clearAccount() {
    clearSelection();
    setMe(null);
    setMobileMenuOpen(false);
    setEmployees([]);
    setShowDisabledEmployees(false);
    setRoles([]);
    setLevels([]);
    setUsers([]);
    setEvents([]);
    setHistory(null);
    setDialog(null);
    setNotice("");
  }
  async function load() {
    if (!import.meta.env.DEV && !currentLaunchData()) {
      clearAccount();
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const current = await api<Me>("/me");
      setMe(current);
      const requests = [
        api<{ roles: Role[]; levels: Level[] }>("/catalog").then((v) => {
          setRoles(v.roles);
          setLevels(v.levels);
        }),
      ];
      if (can(current.user, "employees.manage"))
        requests.push(
          api<{ employees: Employee[] }>("/employees").then((v) =>
            setEmployees(v.employees),
          ),
        );
      if (current.user.access === "super_admin")
        requests.push(
          api<{ users: AdminUser[] }>("/admin/users").then((v) =>
            setUsers(v.users),
          ),
        );
      if (can(current.user, "audit.view"))
        requests.push(
          api<{ events: Audit[] }>("/audit").then((v) => setEvents(v.events)),
        );
      await Promise.all(requests);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearAccount();
      }
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    window.Telegram?.WebApp.ready();
    window.Telegram?.WebApp.expand();
    if (window.Telegram?.WebApp.initData) void login();
    else if (import.meta.env.DEV) void load();
    else setLoading(false);
  }, []);
  useEffect(() => {
    setNotice("");
    setSearch("");
  }, [page]);
  async function login(data = window.Telegram?.WebApp.initData ?? "") {
    clearAccount();
    setLoading(true);
    setLoginBusy(true);
    setError("");
    try {
      await api("/auth/telegram", "POST", { initData: data });
      if (import.meta.env.DEV) setLocalLaunchData(data);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoginBusy(false);
      setLoading(false);
    }
  }
  if (!me)
    return (
      <main className="login">
        <div className="login-art">
          <Brand />
          <div className="login-art-copy">
            <span className="eyebrow">{t("workspace")}</span>
            <h1>{t("teamTitle")}</h1>
            <div className="abstract-team">
              <span>I</span>
              <span>Z</span>
              <span>E</span>
            </div>
            <p>{t("location")}</p>
          </div>
          <div className="login-art-foot">IELTS ZONE / TEAM WORKSPACE</div>
        </div>
        <section className="login-content">
          <span className="tag">{t("phase")}</span>
          <h2>{t("teamTitle")}</h2>
          <p>{t("loginSub")}</p>
          {loading ? (
            <p role="status">{t("loading")}</p>
          ) : (
            <>
              <button
                className="primary"
                disabled={loginBusy || !window.Telegram?.WebApp.initData}
                onClick={() => void login()}
              >
                {t("login")}
                <Icon name="arrow" />
              </button>
              {error && (
                <div className="alert" role="alert">
                  {error}
                </div>
              )}
              <p className="privacy">
                <Icon name="access" />
                {t("privacy")}
              </p>
              <button
                className="text-button"
                onClick={() =>
                  window.Telegram?.WebApp.initData ? void login() : void load()
                }
              >
                {t("retry")}
              </button>
            </>
          )}
          {import.meta.env.DEV && (
            <details className="local-login">
              <summary>{t("localTitle")}</summary>
              <p>{t("localHelp")}</p>
              <label>
                {t("localData")}
                <textarea
                  value={localData}
                  onChange={(e) => setLocalData(e.target.value)}
                  rows={4}
                />
              </label>
              <button
                disabled={!localData || loginBusy}
                className="secondary"
                onClick={() => void login(localData)}
              >
                {t("login")}
              </button>
            </details>
          )}
        </section>
      </main>
    );
  const { user, today } = me;
  const links = [
    { id: "overview", visible: user.access !== "employee" },
    { id: "myAttendance", visible: !!me.employee },
    { id: "attendance", visible: can(user, "attendance.manage") },
    { id: "requests", visible: can(user, "attendance.manage") },
    { id: "reviews", visible: can(user, "attendance.manage") },
    { id: "myDiscipline", visible: !!me.employee },
    {
      id: "payroll",
      visible: can(user, "salary.manage") || can(user, "payroll.approve"),
    },
    { id: "salaryHistory", visible: !!me.employee },
    { id: "debtors", visible: user.access !== "employee" || me.employee?.role_id === "cashier" },
    { id: "schedules", visible: can(user, "attendance.manage") },
    { id: "tablets", visible: user.access === "super_admin" },
    { id: "profile", visible: true },
    { id: "employees", visible: can(user, "employees.manage") },
    { id: "roles", visible: can(user, "salary.manage") },
    { id: "access", visible: user.access === "super_admin" },
    { id: "audit", visible: can(user, "audit.view") },
    { id: "messages", visible: user.access !== "employee" },
  ].filter((v) => v.visible);
  // Related pages share one sidebar entry and switch with tabs at the top of the page.
  const sections: Record<string, string[]> = {
    today: ["reviews", "attendance", "requests"],
    settings: ["roles", "tablets", "access", "audit"],
  };
  const sectionPages = (id: string) =>
    (sections[id] ?? [id]).filter((p) => links.some((l) => l.id === p));
  const sectionOf = (id: string) =>
    Object.keys(sections).find((s) => sections[s].includes(id)) ?? id;
  const open = (id: string) => {
    clearSelection();
    setNavigationVersion((v) => v + 1);
    setPage(id);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0 });
  };
  const currentPage = links.some((l) => l.id === page)
    ? page
    : me.employee
      ? "myAttendance"
      : "profile";
  const visibleEmployees = employees.filter(
    (e) =>
      (showDisabledEmployees || !!e.active) &&
      `${e.full_name} ${e.role_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const usableLevels = levels.filter(
    (l) => l.active && roles.find((r) => r.id === l.role_id)?.active,
  );
  const levelOptions = usableLevels.map((l) => ({
    value: l.id,
    label: `${roles.find((r) => r.id === l.role_id)?.name} · ${l.name}`,
  }));
  const dateField: Field = {
    key: "effectiveDate",
    label: "effectiveDate",
    type: "date",
    initial: today,
  };
  const reasonField: Field = { key: "reason", label: "reason" };
  const addEmployee = () =>
    setDialog({
      title: t("newEmployee"),
      path: "/employees",
      fields: [
        { key: "fullName", label: "fullName" },
        { key: "telegramId", label: "telegramId" },
        {
          key: "levelId",
          label: "roleLevel",
          type: "select",
          options: levelOptions,
        },
        {
          key: "activationDate",
          label: "activationDate",
          type: "date",
          initial: today,
        },
      ],
    });
  const editEmployee = (e: Employee) =>
    setDialog({
      title: t("editEmployee"),
      path: `/employees/${e.id}`,
      method: "PATCH",
      fields: [
        { key: "fullName", label: "fullName", initial: e.full_name },
        {
          key: "active",
          label: "accountEnabled",
          type: "checkbox",
          initial: !!e.active,
        },
        reasonField,
      ],
      // Send only what changed: toggling `active` revokes sessions and sets the end date.
      transform: ({ fullName, active, reason }) => ({
        ...(fullName !== e.full_name ? { fullName } : {}),
        ...(active !== !!e.active ? { active } : {}),
        reason,
      }),
    });
  const changeLevel = (e: Employee) =>
    setDialog({
      title: t("changeLevel"),
      path: `/employees/${e.id}`,
      method: "PATCH",
      fields: [
        {
          key: "levelId",
          label: "roleLevel",
          type: "select",
          options: levelOptions,
        },
        dateField,
        reasonField,
      ],
    });
  const addRole = () =>
    setDialog({
      title: t("newRole"),
      path: "/roles",
      fields: [{ key: "name", label: "roleName" }],
    });
  const addLevel = (role: Role) =>
    setDialog({
      title: t("newLevel") + " · " + role.name,
      help: t("rateHelp"),
      path: `/roles/${role.id}/levels`,
      fields: [
        { key: "name", label: "levelName" },
        { key: "hourlyRate", label: "hourlyRate", type: "number" },
        dateField,
      ],
    });
  const setRate = (level: Level) =>
    setDialog({
      title: t("newRate") + " · " + level.name,
      help: t("rateHelp"),
      path: `/levels/${level.id}/rates`,
      fields: [
        { key: "hourlyRate", label: "hourlyRate", type: "number" },
        dateField,
        reasonField,
      ],
    });
  const editCatalog = (item: Role, isLevel = false) =>
    setDialog({
      title: t(isLevel ? "editLevel" : "rename"),
      help: t("catalogHelp"),
      path: `/${isLevel ? "levels" : "roles"}/${item.id}`,
      method: "PATCH",
      fields: [
        {
          key: "name",
          label: isLevel ? "levelName" : "roleName",
          initial: item.name,
        },
        {
          key: "active",
          label: "activeInCatalog",
          type: "checkbox",
          initial: !!item.active,
        },
        reasonField,
      ],
    });
  async function showHistory(e: Employee) {
    setError("");
    try {
      setHistory(await api(`/employees/${e.id}/history`));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const titles: Record<string, [TextKey, TextKey]> = {
    overview: ["welcome", "overviewSub"],
    employees: ["employeeTitle", "employeeSub"],
    roles: ["rolesTitle", "rolesSub"],
    access: ["accessTitle", "accessSub"],
    audit: ["auditTitle", "auditSub"],
    profile: ["profileTitle", "profileSub"],
    myAttendance: ["myAttendanceTitle", "myAttendanceSub"],
    attendance: ["attendanceTitle", "attendanceSub"],
    requests: ["requestsTitle", "requestsSub"],
    reviews: ["reviewsTitle", "reviewsSub"],
    myDiscipline: ["myDisciplineTitle", "myDisciplineSub"],
    payroll: ["payrollTitle", "payrollSub"],
    salaryHistory: ["salaryHistory", "salaryHistorySub"],
    debtors: ["debtors", "debtorsSub"],
    schedules: ["schedulesTitle", "schedulesSub"],
    tablets: ["tabletsTitle", "tabletsSub"],
    messages: ["messages", "messagesSub"],
  };
  const [title, sub] = titles[currentPage];
  return (
    <div className="shell">
      <aside className={`sidebar ${mobileMenuOpen ? "menu-open" : ""}`}>
        <Brand />
        <div className="workspace">
          <span className="workspace-icon">IZ</span>
          <div>
            {t("workspace")}
            <small>{t("location")}</small>
          </div>
        </div>
        <button
          className="mobile-menu-toggle"
          aria-expanded={mobileMenuOpen}
          aria-controls="main-navigation"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? t("close") : t("menu")}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            {mobileMenuOpen ? (
              <path d="m6 6 12 12M6 18 18 6" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        <nav id="main-navigation" aria-label="Main navigation">
          {[
            {
              label: t("navDailyWork"),
              ids: [
                "overview",
                "myAttendance",
                "today",
                "myDiscipline",
                "payroll",
                "salaryHistory",
                "debtors",
                "schedules",
              ],
            },
            { label: t("navTeam"), ids: ["employees", "messages"] },
            { label: t("navAccount"), ids: ["settings", "profile"] },
          ].map((group) => {
            const items = group.ids.filter((id) => sectionPages(id).length);
            return (
              items.length > 0 && (
                <div className="nav-group" key={group.label}>
                  <span className="nav-group-label">{group.label}</span>
                  {items.map((id) => {
                    const selected = sectionOf(currentPage) === id;
                    return (
                      <button
                        key={id}
                        onClick={() => open(sectionPages(id)[0])}
                        className={selected ? "selected" : ""}
                        aria-current={selected ? "page" : undefined}
                      >
                        <Icon name={id} />
                        {t(id as TextKey)}
                        {selected && <span className="nav-dot" />}
                      </button>
                    );
                  })}
                </div>
              )
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <span className="avatar">{user.fullName.slice(0, 1)}</span>
            <div>
              {user.fullName}
              <small>{t(user.access)}</small>
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                await api("/auth/logout", "POST", {});
                clearAccount();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Icon name="logout" size={17} />
            {t("signOut")}
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            {t(currentPage as TextKey)}{" "}
            <span className="topbar-divider">/</span>{" "}
            <span className="muted">{t("workspace")}</span>
          </span>
          <div>
            <span className="top-avatar">{user.fullName.slice(0, 1)}</span>
          </div>
        </header>
        <main className="content">
          {(can(user, "salary.manage") || can(user, "payroll.approve")) && (
            <SalaryReviewFlow
              key={`salary-guide:${navigationVersion}`}
              permissions={{
                attendance: can(user, "attendance.manage"),
                rates: can(user, "salary.manage"),
                approve: can(user, "payroll.approve"),
                superAdmin: user.access === "super_admin",
              }}
            />
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow dark">
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: "Asia/Tashkent",
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(new Date())}
              </div>
              <h1>{t(title)}</h1>
              <p>{t(sub)}</p>
            </div>
            {currentPage === "employees" && (
              <button
                className="primary"
                onClick={addEmployee}
                disabled={!levelOptions.length}
              >
                <Icon name="plus" />
                {t("newEmployee")}
              </button>
            )}
            {currentPage === "roles" && (
              <button className="primary" onClick={addRole}>
                <Icon name="plus" />
                {t("newRole")}
              </button>
            )}
          </div>
          {sectionPages(sectionOf(currentPage)).length > 1 && (
            <div className="discipline-tabs section-tabs" role="tablist">
              {sectionPages(sectionOf(currentPage)).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={currentPage === id}
                  className={currentPage === id ? "primary" : "secondary"}
                  onClick={() => open(id)}
                >
                  {t(id as TextKey)}
                </button>
              ))}
            </div>
          )}
          {loading && (
            <div className="status-message" role="status">
              {t("loading")}
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => void load()}>{t("retry")}</button>
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              <Icon name="check" />
              {notice}
            </div>
          )}
          {currentPage === "overview" && (
            <Overview user={user} onNavigate={open} />
          )}
          {currentPage === "messages" && <TelegramMessages />}
          {currentPage === "employees" && (
            <section className="panel">
              <div className="panel-header">
                <h2>
                  {t("employees")}{" "}
                  <span className="count">{visibleEmployees.length}</span>
                </h2>
                <label className="search">
                  <Icon name="search" size={18} />
                  <span className="sr-only">{t("search")}</span>
                  <input
                    placeholder={t("searchPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="attendance-panel">
                <EmployeeVisibility
                  showDisabled={showDisabledEmployees}
                  onChange={(show) => {
                    setShowDisabledEmployees(show);
                    if (!show) setHistory(null);
                  }}
                  disabledCount={employees.filter((e) => !e.active).length}
                />
              </div>
              {employees.length === 0 ? (
                <Empty
                  title={t("emptyEmployees")}
                  sub={t("emptyEmployeesSub")}
                />
              ) : (
                <div className="employee-card-grid employee-directory">
                  {visibleEmployees.map((e) => (
                    <article
                      className="employee-card employee-directory-card"
                      data-employee-id={e.id}
                      key={e.id}
                    >
                      <div>
                        <div className="person">
                          <span className="avatar pale">
                            {e.full_name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>{e.full_name}</strong>
                            <small>Telegram · {e.telegram_id}</small>
                          </div>
                        </div>
                      </div>
                      <div>
                        {e.role_name ?? t("notAssigned")}
                        <small>{e.level_name}</small>
                      </div>
                      <div>
                        <span
                          className={
                            "badge " +
                            (!e.active
                              ? "disabled"
                              : e.activation_date > today
                                ? "status-attention"
                                : "status-good")
                          }
                        >
                          {t(
                            !e.active
                              ? "inactive"
                              : e.activation_date > today
                                ? "scheduled"
                                : "active",
                          )}
                        </span>
                      </div>
                      <div>
                        <details className="row-menu">
                          <summary>{t("actions")}</summary>
                          <div>
                            <button onClick={() => editEmployee(e)}>
                              {t("edit")}
                            </button>
                            {can(user, "salary.manage") && (
                              <>
                                <button onClick={() => changeLevel(e)}>
                                  {t("changeLevel")}
                                </button>
                                <button onClick={() => void showHistory(e)}>
                                  {t("history")}
                                </button>
                              </>
                            )}
                            {user.access === "super_admin" && (
                              <button
                                onClick={() =>
                                  setDialog({
                                    title: t("relinkTitle"),
                                    help: t("relinkHelp"),
                                    path: `/employees/${e.id}/telegram`,
                                    fields: [
                                      {
                                        key: "telegramId",
                                        label: "telegramId",
                                        initial: e.telegram_id,
                                      },
                                      reasonField,
                                    ],
                                  })
                                }
                              >
                                {t("relink")}
                              </button>
                            )}
                            {user.access === "super_admin" &&
                              !e.active &&
                              e.access === "employee" && (
                                <button
                                  onClick={() =>
                                    setDialog({
                                      title: `${t("deletePermanently")} · ${e.full_name}`,
                                      help: t("deleteEmployeeHelp"),
                                      path: `/employees/${e.id}/delete`,
                                      fields: [
                                        { key: "confirmName", label: "confirmFullName" },
                                        reasonField,
                                      ],
                                    })
                                  }
                                >
                                  {t("deletePermanently")}
                                </button>
                              )}
                          </div>
                        </details>
                      </div>
                    </article>
                  ))}
                  {visibleEmployees.length === 0 && (
                    <Empty title={t("noMatches")} />
                  )}
                </div>
              )}
            </section>
          )}
          {currentPage === "roles" && (
            <div className="roles-grid">
              {roles.map((role) => (
                <section className="panel role-card" key={role.id}>
                  <div className="panel-header">
                    <div className="role-icon">
                      <Icon name="roles" />
                    </div>
                    <h2>
                      {role.name}
                      {!role.active && <small>{t("inactive")}</small>}
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => editCatalog(role)}
                    >
                      {t("editCatalogItem")}
                    </button>
                  </div>
                  <RoleDailyPay roleId={role.id} active={!!role.active} />
                  <div className="level-list">
                    {levels
                      .filter((l) => l.role_id === role.id)
                      .map((level) => (
                        <div className="level-row" key={level.id}>
                          <div>
                            <strong>
                              {level.name}
                              {!level.active && <small>{t("inactive")}</small>}
                            </strong>
                            <span>
                              {level.hourly_rate === null ||
                              level.hourly_rate === undefined
                                ? t("notConfigured")
                                : formatMoney(level.hourly_rate)}
                              <small> / hour</small>
                            </span>
                          </div>
                          <div className="level-buttons">
                            <button
                              className="text-button"
                              onClick={() => setRate(level)}
                            >
                              {t("newRate")}
                            </button>
                            <button
                              className="text-button"
                              onClick={() => editCatalog(level, true)}
                            >
                              {t("editCatalogItem")}
                            </button>
                          </div>
                        </div>
                      ))}
                    {!levels.some((l) => l.role_id === role.id) && (
                      <p className="empty-levels">{t("noLevels")}</p>
                    )}
                  </div>
                  <button
                    className="add-level"
                    disabled={!role.active}
                    onClick={() => addLevel(role)}
                  >
                    <Icon name="plus" size={17} />
                    {t("newLevel")}
                  </button>
                </section>
              ))}
            </div>
          )}
          {currentPage === "access" && (
            <section className="panel">
              <div className="attendance-panel">
                <EmployeeVisibility
                  showDisabled={showDisabledEmployees}
                  onChange={setShowDisabledEmployees}
                  disabledCount={users.filter((u) => !u.active).length}
                />
              </div>
              <div className="employee-card-grid employee-directory">
                {users
                  .filter((u) => showDisabledEmployees || !!u.active)
                  .map((u) => (
                    <article
                      className="employee-card employee-directory-card"
                      data-employee-id={u.id}
                      key={u.id}
                    >
                      <div>
                        <strong>{u.full_name}</strong>
                        <small>{u.telegram_id}</small>
                      </div>
                      <div>
                        <span className="badge">{t(u.access)}</span>
                        {!u.active && <small>{t("inactive")}</small>}
                      </div>
                      <div>
                        {u.access === "super_admin"
                          ? "All permissions"
                          : u.permissions.map((p) => t(p)).join(", ") || "—"}
                      </div>
                      <div>
                        {u.access !== "super_admin" && (
                          <button
                            className="secondary compact"
                            onClick={() =>
                              setDialog({
                                title: t("manage") + " · " + u.full_name,
                                path: `/admin/users/${u.id}/access`,
                                fields: [
                                  {
                                    key: "access",
                                    label: "accessType",
                                    type: "select",
                                    initial: u.access,
                                    options: [
                                      {
                                        value: "employee",
                                        label: t("employee"),
                                      },
                                      { value: "admin", label: t("admin") },
                                    ],
                                  },
                                  {
                                    key: "permissions",
                                    label: "permissionTitle",
                                    type: "permissions",
                                    initial: u.permissions,
                                  },
                                  reasonField,
                                ],
                                transform: (values) => ({
                                  ...values,
                                  permissions:
                                    values.access === "employee"
                                      ? []
                                      : values.permissions,
                                }),
                              })
                            }
                          >
                            {t("manage")}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          )}
          {currentPage === "audit" && (
            <section className="panel">
              {!events.length ? (
                <Empty title={t("emptyAudit")} />
              ) : (
                <div className="audit-list">
                  {events.map((event) => (
                    <article key={event.id}>
                      <span className="audit-icon">
                        <Icon name="audit" size={18} />
                      </span>
                      <div>
                        <strong>{auditSummary(event)}</strong>
                        <p>
                          {event.actor_name}
                          {event.reason ? " — " + event.reason : ""}
                        </p>
                        <details>
                          <summary>Full audit record</summary>
                          <pre>
                            {JSON.stringify(
                              {
                                before: event.before_json
                                  ? JSON.parse(event.before_json)
                                  : null,
                                after: event.after_json
                                  ? JSON.parse(event.after_json)
                                  : null,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </div>
                      <time>
                        {new Intl.DateTimeFormat("en-GB", {
                          timeZone: "Asia/Tashkent",
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(event.created_at * 1000)}
                      </time>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {currentPage === "myAttendance" && <EmployeeAttendance />}
          {currentPage === "myDiscipline" && (
            <DisciplineScreen key={navigationVersion} />
          )}
          {currentPage === "salaryHistory" && <SalaryHistory />}
          {currentPage === "debtors" && <DebtorsScreen hasEmployee={!!me.employee} canViewPayroll={can(user, "salary.manage") || can(user, "payroll.approve")} />}
          {currentPage === "payroll" && (
            <PayrollScreen
              key={navigationVersion}
              canApprove={can(user, "payroll.approve")}
              canAttendance={can(user, "attendance.manage")}
              canRates={can(user, "salary.manage")}
              superAdmin={user.access === "super_admin"}
            />
          )}
          {currentPage === "reviews" && (
            <DisciplineScreen
              key={navigationVersion}
              admin
              canPayroll={
                can(user, "salary.manage") || can(user, "payroll.approve")
              }
              canApprove={can(user, "payroll.approve")}
              superAdmin={user.access === "super_admin"}
              onRequests={() => setPage("requests")}
              onAttendance={() => setPage("attendance")}
            />
          )}
          {currentPage === "attendance" && (
            <AdminAttendance key={navigationVersion} />
          )}
          {currentPage === "requests" && (
            <RequestManager
              key={navigationVersion}
              superAdmin={user.access === "super_admin"}
            />
          )}
          {currentPage === "schedules" && (
            <ScheduleManager key={navigationVersion} />
          )}
          {currentPage === "tablets" && <TabletManager />}
          {currentPage === "profile" && (
            <section className="panel profile-card">
              <div className="profile-intro">
                <span className="avatar large">
                  {user.fullName.slice(0, 1)}
                </span>
                <h2>{user.fullName}</h2>
                <span className="badge">{t(user.access)}</span>
              </div>
              <dl>
                {[
                  [t("telegramAccount"), user.telegramId],
                  [
                    t("roleLevel"),
                    me.employee
                      ? `${me.employee.role_name ?? t("notAssigned")} · ${me.employee.level_name ?? "—"}`
                      : "—",
                  ],
                  [
                    t("currentRate"),
                    me.employee?.hourly_rate === null ||
                    me.employee?.hourly_rate === undefined
                      ? "—"
                      : formatMoney(me.employee.hourly_rate),
                  ],
                  [t("employmentStart"), me.employee?.activation_date ?? "—"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="profile-note">
                {me.employee ? t("warning") : t("noEmployeeProfile")}
              </div>
            </section>
          )}
          <footer>
            {t("timezone")}
            <span>{t("brand")}</span>
          </footer>
        </main>
      </div>
      {dialog && (
        <ActionDialog
          key={dialog.path + dialog.title}
          dialog={dialog}
          close={() => setDialog(null)}
          saved={async () => {
            setDialog(null);
            await load();
            setNotice(t("confirmed"));
          }}
        />
      )}
      {history && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <h2 id="history-title">{t("history")}</h2>
            <h3>{t("assigned")}</h3>
            {history.assignments.map((a, i) => (
              <p key={i}>
                {String(a.effective_date)} · {String(a.role_name)} /{" "}
                {String(a.level_name)}
              </p>
            ))}
            <h3>{t("rateRecords")}</h3>
            {history.rates.map((r, i) => (
              <p key={i}>
                {String(r.effective_date)} ·{" "}
                {formatMoney(Number(r.hourly_rate))}
              </p>
            ))}
            <button
              className="secondary"
              autoFocus
              onClick={() => setHistory(null)}
            >
              {t("close")}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="empty">
      <span>
        <Icon name="employees" size={32} />
      </span>
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
    </div>
  );
}
function ActionDialog({
  dialog,
  close,
  saved,
}: {
  dialog: Dialog;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      dialog.fields.map((f) => [
        f.key,
        f.initial ??
          (f.type === "permissions"
            ? []
            : f.type === "checkbox"
              ? false
              : f.type === "select"
                ? (f.options?.[0]?.value ?? "")
                : ""),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) close();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, close]);
  function update(field: string, value: unknown) {
    setValues((v) => ({ ...v, [field]: value }));
    setKey(crypto.randomUUID());
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        dialog.path,
        dialog.method ?? "POST",
        dialog.transform ? dialog.transform(values) : values,
        key,
      );
      await saved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-title">
          <h2 id="dialog-title">{dialog.title}</h2>
          <button onClick={close} disabled={busy} aria-label={t("close")}>
            ×
          </button>
        </div>
        {dialog.help && <p className="modal-help">{dialog.help}</p>}
        <form onSubmit={(e) => void submit(e)}>
          {dialog.fields.map((field, index) =>
            field.type === "permissions" ? (
              <fieldset key={field.key}>
                <legend>{t(field.label)}</legend>
                {permissions.map((p) => (
                  <label className="check-label" key={p}>
                    <input
                      type="checkbox"
                      disabled={busy || values.access === "employee"}
                      checked={(values[field.key] as string[]).includes(p)}
                      onChange={(e) =>
                        update(
                          field.key,
                          e.target.checked
                            ? [...(values[field.key] as string[]), p]
                            : (values[field.key] as string[]).filter(
                                (v) => v !== p,
                              ),
                        )
                      }
                    />
                    {t(p)}
                  </label>
                ))}
              </fieldset>
            ) : field.type === "checkbox" ? (
              <label key={field.key} className="check-label">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={!!values[field.key]}
                  onChange={(e) => update(field.key, e.target.checked)}
                />
                {t(field.label)}
              </label>
            ) : (
              <label key={field.key}>
                {t(field.label)}
                {field.type === "select" ? (
                  <select
                    disabled={busy}
                    value={String(values[field.key])}
                    required
                    onChange={(e) => update(field.key, e.target.value)}
                  >
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    autoFocus={index === 0}
                    disabled={busy}
                    type={field.type ?? "text"}
                    min={field.type === "number" ? 0 : undefined}
                    max={field.type === "number" ? 1_000_000_000 : undefined}
                    step={field.type === "number" ? 1 : undefined}
                    maxLength={field.key === "reason" ? 1000 : 100}
                    value={String(values[field.key])}
                    required={
                      field.key !== "reason" && field.required !== false
                    }
                    onChange={(e) =>
                      update(
                        field.key,
                        field.type === "number"
                          ? e.target.value === ""
                            ? ""
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}
              </label>
            ),
          )}
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              onClick={close}
              disabled={busy}
            >
              {t("cancel")}
            </button>
            <button className="primary" disabled={busy}>
              {busy ? t("loading") : t("save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname.startsWith("/reception") ? <Reception /> : <App />,
);
