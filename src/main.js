import { COURSE, STEP_TYPES, allLessons, findLesson, lessonProgress } from "./course.js";

const STORAGE_KEY = "r-course-university-v1";
const THEME_KEY = "r-course-theme";

const defaultState = () => ({
  seenWelcome: false,
  activeLessonId: "m0-l1",
  stepIndex: 0,
  completedSteps: {},
  completedLessons: [],
  collapsedModules: {},
  sidebarOpen: false,
  actionsOpen: false,
  helpOpen: false,
  showInstructor: false,
  draft: {},
  hintLevel: {},
  showSolution: {},
});

let state = defaultState();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s) state = { ...defaultState(), ...s };
  } catch {
    /* ignore */
  }
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      seenWelcome: state.seenWelcome,
      activeLessonId: state.activeLessonId,
      stepIndex: state.stepIndex,
      completedSteps: state.completedSteps,
      completedLessons: state.completedLessons,
      collapsedModules: state.collapsedModules,
      showInstructor: state.showInstructor,
      helpOpen: state.helpOpen,
    }),
  );
}

function getTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function setTheme(theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  localStorage.setItem(THEME_KEY, theme);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "disabled") node.disabled = Boolean(v);
    else if (k === "hidden") node.hidden = Boolean(v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else if (child) node.appendChild(child);
  }
  return node;
}

function formatText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function stepKey(lessonId, index) {
  return `${lessonId}:${index}`;
}

function isStepDone(lessonId, index) {
  return (state.completedSteps[lessonId] ?? []).includes(index);
}

function markStepDone(lessonId, index) {
  if (!state.completedSteps[lessonId]) state.completedSteps[lessonId] = [];
  if (!state.completedSteps[lessonId].includes(index)) {
    state.completedSteps[lessonId].push(index);
  }
  const found = findLesson(lessonId);
  if (found && state.completedSteps[lessonId].length >= found.lesson.steps.length) {
    if (!state.completedLessons.includes(lessonId)) {
      state.completedLessons.push(lessonId);
    }
  }
  persist();
}

function normalizeCode(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function checkCode(code, checks) {
  const n = normalizeCode(code);
  return checks.every((c) => n.includes(normalizeCode(c)));
}

function overallProgress() {
  const lessons = allLessons();
  const done = state.completedLessons.length;
  return {
    done,
    total: lessons.length,
    pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
  };
}

function copyButton(text, label = "Скопировать код") {
  return el("button", {
    type: "button",
    className: "copy-btn",
    text: label,
    onClick: async (e) => {
      await navigator.clipboard.writeText(text);
      const btn = e.currentTarget;
      const old = btn.textContent;
      btn.textContent = "Скопировано";
      setTimeout(() => {
        btn.textContent = old;
      }, 1600);
    },
  });
}

function syncBodyUiLock() {
  const lock = state.sidebarOpen || state.actionsOpen;
  document.body.classList.toggle("ui-locked", lock);
}

function closeOverlays() {
  state.sidebarOpen = false;
  state.actionsOpen = false;
}

function goToStep(lessonId, index) {
  state.activeLessonId = lessonId;
  state.stepIndex = index;
  closeOverlays();
  persist();
  render();
  document.getElementById("main-content")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function nextStep() {
  const found = findLesson(state.activeLessonId);
  if (!found) return;
  const { lesson } = found;
  const i = state.stepIndex;
  markStepDone(lesson.id, i);
  if (i < lesson.steps.length - 1) {
    state.stepIndex = i + 1;
  } else {
    const lessons = allLessons();
    const idx = lessons.findIndex((l) => l.id === lesson.id);
    if (idx < lessons.length - 1) {
      state.activeLessonId = lessons[idx + 1].id;
      state.stepIndex = 0;
    }
  }
  persist();
  render();
}

function prevStep() {
  if (state.stepIndex > 0) {
    state.stepIndex -= 1;
  } else {
    const lessons = allLessons();
    const idx = lessons.findIndex((l) => l.id === state.activeLessonId);
    if (idx > 0) {
      const prev = findLesson(lessons[idx - 1].id);
      if (prev) {
        state.activeLessonId = prev.lesson.id;
        state.stepIndex = prev.lesson.steps.length - 1;
      }
    }
  }
  persist();
  render();
}

function resetProgress() {
  if (!confirm("Сбросить весь прогресс на этом устройстве? Тексты уроков останутся.")) return;
  state = defaultState();
  state.seenWelcome = true;
  persist();
  render();
}

function renderWelcome() {
  return el("div", { className: "welcome" }, [
    el("div", { className: "welcome__card" }, [
      el("span", { className: "welcome__badge", text: "Университетский курс" }),
      el("h1", { text: COURSE.title }),
      el("p", { className: "lead", text: COURSE.subtitle }),
      el("p", { className: "tagline", text: COURSE.tagline }),
      el("div", { className: "welcome__grid" }, [
        el("div", { className: "welcome__box" }, [
          el("h3", { text: "Для студентов" }),
          el("p", { text: COURSE.audience }),
        ]),
        el("div", { className: "welcome__box" }, [
          el("h3", { text: "Объём" }),
          el("p", { text: COURSE.duration }),
        ]),
      ]),
      el("div", { className: "welcome__box welcome__box--teacher" }, [
        el("h3", { text: "Для преподавателя" }),
        el("p", { text: COURSE.forTeachers }),
      ]),
      el("ul", { className: "welcome__list" }, [
        el("li", { text: "Шаги: теория → пример с копированием → практика в RStudio" }),
        el("li", { text: "Подсказки и образцы ответов — можно идти в своём темпе" }),
        el("li", { text: "Прогресс сохраняется в браузере (не нужен аккаунт)" }),
      ]),
      el("button", {
        type: "button",
        className: "btn btn--primary btn--xl",
        text: "Начать с урока 1",
        onClick: () => {
          state.seenWelcome = true;
          state.activeLessonId = "m0-l1";
          state.stepIndex = 0;
          persist();
          render();
        },
      }),
    ]),
  ]);
}

function renderOutline() {
  const nav = el("nav", {
    className: `outline${state.sidebarOpen ? " outline--open" : ""}`,
    "aria-label": "Содержание курса",
  });

  nav.appendChild(
    el("div", { className: "outline__head" }, [
      el("strong", { text: "Содержание" }),
      el("span", { className: "outline__pct", text: `${overallProgress().pct}%` }),
      el("button", {
        type: "button",
        className: "outline__close",
        "aria-label": "Закрыть меню",
        text: "×",
        onClick: () => {
          closeOverlays();
          render();
        },
      }),
    ]),
  );

  for (const mod of COURSE.modules) {
    const collapsed = state.collapsedModules[mod.id] ?? false;
    const modLessons = mod.lessons;
    const modDone = modLessons.filter((l) => state.completedLessons.includes(l.id)).length;

    const head = el("button", {
      type: "button",
      className: "outline__mod-btn",
      "aria-expanded": String(!collapsed),
      onClick: () => {
        state.collapsedModules[mod.id] = !collapsed;
        persist();
        render();
      },
    }, [
      el("span", { className: "outline__chev", text: collapsed ? "▸" : "▾" }),
      el("span", { className: "outline__mod-title", text: mod.title }),
      el("span", { className: "outline__mod-count", text: `${modDone}/${modLessons.length}` }),
    ]);
    nav.appendChild(head);

    if (!collapsed) {
      nav.appendChild(el("p", { className: "outline__mod-desc", text: mod.description }));
      for (const lesson of modLessons) {
        const prog = lessonProgress(lesson, state.completedSteps);
        const active = state.activeLessonId === lesson.id;
        const done = state.completedLessons.includes(lesson.id);
        nav.appendChild(
          el("button", {
            type: "button",
            className: `outline__lesson${active ? " outline__lesson--active" : ""}${done ? " outline__lesson--done" : ""}`,
            onClick: () => goToStep(lesson.id, 0),
          }, [
            el("span", { className: "outline__check", text: done ? "✓" : "○" }),
            el("span", { className: "outline__lesson-body" }, [
              el("span", { className: "outline__lesson-title", text: lesson.title }),
              lesson.minutes
                ? el("span", { className: "outline__lesson-min", text: `~${lesson.minutes} мин` })
                : null,
            ]),
            el("span", { className: "outline__lesson-prog", text: `${prog.done}/${prog.total}` }),
          ]),
        );
      }
    }
  }

  return nav;
}

function renderBlocks(blocks) {
  const frag = [];
  for (const b of blocks ?? []) {
    if (b.kind === "p") {
      frag.push(el("p", { className: "prose", html: formatText(b.text) }));
    } else if (b.kind === "list") {
      if (b.title) frag.push(el("h4", { className: "prose__h", text: b.title }));
      const ul = el("ul", { className: "prose__ul" });
      for (const item of b.items) ul.appendChild(el("li", { html: formatText(item) }));
      frag.push(ul);
    } else if (b.kind === "note") {
      frag.push(
        el("div", { className: "callout callout--note", role: "note" }, [
          el("span", { className: "callout__label", text: "Важно" }),
          el("p", { html: formatText(b.text) }),
        ]),
      );
    } else if (b.kind === "classroom") {
      frag.push(
        el("div", { className: "callout callout--class", role: "note" }, [
          el("span", { className: "callout__label", text: b.title || "На паре" }),
          el("p", { html: formatText(b.text) }),
        ]),
      );
    } else if (b.kind === "takeaway") {
      const ul = el("ul", { className: "takeaway__list" });
      for (const item of b.items) ul.appendChild(el("li", { html: formatText(item) }));
      frag.push(
        el("div", { className: "takeaway" }, [
          b.title ? el("h4", { className: "takeaway__title", text: b.title }) : null,
          ul,
        ]),
      );
    } else if (b.kind === "diagram") {
      frag.push(
        el("pre", { className: "rstudio-diagram", "aria-label": "Схема окон RStudio" }, [
          document.createTextNode(b.text),
        ]),
      );
    }
  }
  return frag;
}

function stepTypeBadge(type) {
  const t = STEP_TYPES[type] ?? { label: type, short: "?" };
  return el("span", { className: `step-badge step-badge--${type}`, text: t.label });
}

function renderRead(step) {
  return el("div", { className: "step" }, [
    stepTypeBadge("read"),
    el("h2", { className: "step__title", text: step.title }),
    ...renderBlocks(step.blocks),
  ]);
}

function renderTakeawayStep(step) {
  return el("div", { className: "step" }, [
    el("span", { className: "step-badge step-badge--read", text: "Итог урока" }),
    el("h2", { className: "step__title", text: step.title }),
    el("ul", { className: "takeaway__list takeaway__list--large" }, step.items.map((i) => el("li", { text: i }))),
  ]);
}

function renderExample(step) {
  return el("div", { className: "step" }, [
    stepTypeBadge("example"),
    el("h2", { className: "step__title", text: step.title }),
    el("p", { className: "step__lead", text: "Скопируйте код в RStudio (скрипт или консоль). После каждой строки — Ctrl+Enter или Enter в консоли." }),
    el("div", { className: "code-wrap" }, [
      el("pre", { className: "code-box", tabIndex: "0" }, [document.createTextNode(step.code)]),
      copyButton(step.code),
    ]),
    ...(step.lines?.length
      ? [
          el("div", { className: "line-expl" }, step.lines.map((line) =>
            el("div", { className: "line-expl__row" }, [
              el("code", { className: "line-expl__code", text: line.code }),
              el("span", { className: "line-expl__say", text: line.say }),
            ]),
          )),
        ]
      : []),
    ...(step.output
      ? [
          el("div", { className: "output-box" }, [
            el("span", { className: "output-box__label", text: "Пример вывода R" }),
            el("pre", { className: "output-box__pre" }, [document.createTextNode(step.output)]),
            step.outputExplain
              ? el("p", { className: "output-box__hint", html: formatText(step.outputExplain) })
              : null,
          ]),
        ]
      : []),
  ]);
}

function renderPractice(step, lessonId, stepIndex) {
  const draftKey = stepKey(lessonId, stepIndex);
  const code = state.draft[draftKey] ?? step.starter ?? "";
  const hintIdx = state.hintLevel[draftKey] ?? 0;
  const showSol = state.showSolution[draftKey];

  const ta = document.createElement("textarea");
  ta.className = "practice-input";
  ta.rows = 5;
  ta.setAttribute("aria-label", "Поле для ввода кода");
  ta.placeholder = "Введите код для самопроверки. Обязательно повторите в RStudio.";
  ta.value = code;
  ta.spellcheck = false;
  ta.addEventListener("input", () => {
    state.draft[draftKey] = ta.value;
  });

  const feedback = el("div", { className: "feedback", hidden: true });

  const hintBox = el("div", { className: "hint-box" });
  for (let i = 0; i < hintIdx; i++) {
    hintBox.appendChild(el("p", { className: "hint-box__line", text: `Подсказка ${i + 1}: ${step.hints[i]}` }));
  }

  return el("div", { className: "step" }, [
    stepTypeBadge("practice"),
    el("h2", { className: "step__title", text: step.title }),
    el("p", { className: "step__lead", html: formatText(step.instruction) }),
    el("div", { className: "task-box" }, [
      el("span", { className: "task-box__label", text: "Задание" }),
      el("p", { className: "task-box__text", text: step.task }),
    ]),
    ta,
    hintBox,
    showSol && step.solution
      ? el("div", { className: "solution-box" }, [
          el("span", { className: "solution-box__label", text: "Образец ответа" }),
          el("pre", { text: step.solution }),
          copyButton(step.solution, "Скопировать ответ"),
        ])
      : null,
    feedback,
    el("div", { className: "practice-actions" }, [
      el("button", {
        type: "button",
        className: "btn btn--secondary",
        text: hintIdx < (step.hints?.length ?? 0) ? `Подсказка ${hintIdx + 1}` : "Подсказок нет",
        disabled: hintIdx >= (step.hints?.length ?? 0),
        onClick: () => {
          state.hintLevel[draftKey] = hintIdx + 1;
          render();
        },
      }),
      el("button", {
        type: "button",
        className: "btn btn--ghost",
        text: showSol ? "Скрыть ответ" : "Показать ответ",
        onClick: () => {
          state.showSolution[draftKey] = !showSol;
          render();
        },
      }),
      el("button", {
        type: "button",
        className: "btn btn--primary",
        text: "Проверить",
        onClick: () => {
          if (checkCode(ta.value, step.checks)) {
            feedback.className = "feedback feedback--ok";
            feedback.hidden = false;
            feedback.textContent =
              "Верно. Теперь выполните ту же команду в RStudio и убедитесь, что консоль не выдаёт ошибку.";
            markStepDone(lessonId, stepIndex);
          } else {
            feedback.className = "feedback feedback--warn";
            feedback.hidden = false;
            feedback.textContent = "Пока не совпадает. Сравните с подсказкой или образцом ответа.";
          }
        },
      }),
    ]),
    el("p", { className: "muted practice-note", text: "Не получается? Откройте ответ и нажмите «Дальше» — к уроку можно вернуться из меню слева." }),
  ]);
}

function renderQuiz(step, lessonId, stepIndex) {
  const draftKey = stepKey(lessonId, stepIndex);
  const picked = state.draft[draftKey] ?? null;
  const checked = state.draft[`${draftKey}:checked`];

  const opts = el("div", { className: "quiz-opts", role: "group" });
  for (const o of step.options) {
    opts.appendChild(
      el("button", {
        type: "button",
        className: `quiz-opt${picked === o.id ? " quiz-opt--on" : ""}${checked ? (o.id === step.correctId && picked === o.id ? " quiz-opt--ok" : picked === o.id ? " quiz-opt--bad" : "") : ""}`,
        text: o.label,
        onClick: () => {
          state.draft[draftKey] = o.id;
          state.draft[`${draftKey}:checked`] = true;
          if (o.id === step.correctId) markStepDone(lessonId, stepIndex);
          render();
        },
      }),
    );
  }

  let explain = null;
  if (checked && picked) {
    const ok = picked === step.correctId;
    explain = el("div", {
      className: ok ? "feedback feedback--ok" : "feedback feedback--warn",
      html: formatText(ok ? `Верно. ${step.explain}` : `Разбор: ${step.explain}`),
    });
    if (!ok) markStepDone(lessonId, stepIndex);
  }

  return el("div", { className: "step" }, [
    stepTypeBadge("quiz"),
    el("h2", { className: "step__title", text: step.title }),
    el("p", { className: "quiz-q", text: step.question }),
    opts,
    explain,
  ]);
}

function renderStepContent(step, lessonId, stepIndex) {
  if (step.type === "takeaway") return renderTakeawayStep(step);
  switch (step.type) {
    case "read":
      return renderRead(step);
    case "example":
      return renderExample(step);
    case "practice":
      return renderPractice(step, lessonId, stepIndex);
    case "quiz":
      return renderQuiz(step, lessonId, stepIndex);
    default:
      return el("p", { text: "Неизвестный тип шага." });
  }
}

function renderLessonObjectives(lesson) {
  if (!lesson.objectives?.length && !lesson.lecture) return null;
  return el("div", { className: "objectives" }, [
    el("h3", { className: "objectives__title", text: "Цели урока" }),
    lesson.lecture ? el("p", { className: "objectives__lecture", html: formatText(`**Связь с курсом:** ${lesson.lecture}`) }) : null,
    lesson.objectives?.length
      ? el("ul", { className: "objectives__ul" }, lesson.objectives.map((o) => el("li", { text: o })))
      : null,
    lesson.minutes ? el("p", { className: "objectives__time", text: `Ориентир: ~${lesson.minutes} минут` }) : null,
  ]);
}

function renderStepNav(lesson, stepIndex) {
  const list = el("ol", { className: "step-nav" });
  lesson.steps.forEach((s, i) => {
    const meta = STEP_TYPES[s.type] ?? { short: "?" };
    list.appendChild(
      el("li", {}, [
        el("button", {
          type: "button",
          className: `step-nav__btn${i === stepIndex ? " step-nav__btn--cur" : ""}${isStepDone(lesson.id, i) ? " step-nav__btn--done" : ""}`,
          onClick: () => goToStep(lesson.id, i),
        }, [
          el("span", { className: "step-nav__n", text: String(i + 1) }),
          el("span", { className: "step-nav__t", text: s.title }),
          el("span", { className: "step-nav__type", text: meta.label }),
        ]),
      ]),
    );
  });
  return el("nav", { className: "step-nav-wrap", "aria-label": "Шаги урока" }, [list]);
}

function renderLesson() {
  const found = findLesson(state.activeLessonId);
  if (!found) return el("main", { className: "lesson", text: "Урок не найден" });

  const { module, lesson } = found;
  const stepIndex = Math.min(state.stepIndex, lesson.steps.length - 1);
  const step = lesson.steps[stepIndex];
  const prog = overallProgress();

  const stepBar = el("div", { className: "stepbar", role: "progressbar", "aria-valuenow": String(stepIndex + 1), "aria-valuemax": String(lesson.steps.length) });
  lesson.steps.forEach((_, i) => {
    stepBar.appendChild(
      el("button", {
        type: "button",
        className: `stepbar__seg${i === stepIndex ? " stepbar__seg--cur" : ""}${isStepDone(lesson.id, i) ? " stepbar__seg--done" : ""}`,
        title: `Шаг ${i + 1}: ${lesson.steps[i].title}`,
        onClick: () => goToStep(lesson.id, i),
      }),
    );
  });

  return el("main", { className: "lesson", id: "main-content", tabIndex: "-1" }, [
    el("div", { className: "lesson__top" }, [
      el("span", { className: "breadcrumb", text: module.title }),
      el("h1", { className: "lesson__h1", text: lesson.title }),
      el("div", { className: "lesson__meta" }, [
        el("span", { text: `Шаг ${stepIndex + 1} из ${lesson.steps.length}` }),
        el("span", { text: `Курс: ${prog.done} / ${prog.total} уроков (${prog.pct}%)` }),
      ]),
      stepBar,
    ]),
    state.stepIndex === 0 ? renderLessonObjectives(lesson) : null,
    renderStepNav(lesson, stepIndex),
    el("article", { className: "lesson__body" }, [renderStepContent(step, lesson.id, stepIndex)]),
    el("footer", { className: "lesson-foot lesson-foot--inline" }, [
      el("button", { type: "button", className: "btn btn--ghost", text: "← Назад", disabled: stepIndex === 0 && allLessons()[0].id === lesson.id, onClick: prevStep }),
      el("button", {
        type: "button",
        className: "btn btn--primary btn--xl",
        text: stepIndex === lesson.steps.length - 1 ? "Завершить урок →" : "Дальше →",
        onClick: nextStep,
      }),
    ]),
  ]);
}

function buildHelpContent() {
  const items = [
    ["Ctrl+Enter", "Выполнить строку из скрипта"],
    ["Console", "Результат и ошибки"],
    ["Environment", "Переменные и таблицы в памяти"],
    ["Files", "Рабочая папка, CSV"],
    ["Plots", "Графики регрессии"],
    ["lm(y ~ x, data=)", "Оценка МНК"],
    ["summary(m)", "Таблица коэффициентов"],
  ];

  const dl = el("dl", { className: "glossary" });
  for (const [dt, dd] of items) {
    dl.appendChild(el("dt", { text: dt }));
    dl.appendChild(el("dd", { text: dd }));
  }

  const parts = [
    dl,
    el("div", { className: "help-panel__links" }, [
      el("a", { href: "https://cran.r-project.org/", text: "Скачать R", target: "_blank", rel: "noopener" }),
      el("a", { href: "https://posit.co/download/rstudio-desktop/", text: "Скачать RStudio", target: "_blank", rel: "noopener" }),
    ]),
  ];

  if (state.showInstructor) {
    parts.push(
      el("div", { className: "instructor-box" }, [
        el("h4", { text: "Режим преподавателя" }),
        el("p", { text: COURSE.forTeachers }),
        el("p", { className: "muted", text: COURSE.duration }),
      ]),
    );
  }
  return parts;
}

function renderHelpPanel() {
  return el("aside", { className: "help-panel help-panel--desktop", "aria-label": "Справка" }, [
    el("h3", { text: "Шпаргалка" }),
    ...buildHelpContent(),
  ]);
}

function renderHelpMobile() {
  return el("details", { className: "help-mobile", open: state.helpOpen }, [
    el("summary", {
      className: "help-mobile__summary",
      text: "Шпаргалка и ссылки",
      onClick: (e) => {
        e.preventDefault();
        state.helpOpen = !state.helpOpen;
        persist();
        render();
      },
    }),
    el("div", { className: "help-mobile__body" }, buildHelpContent()),
  ]);
}

function renderActionSheet() {
  if (!state.actionsOpen) return null;

  const close = () => {
    state.actionsOpen = false;
    render();
  };

  return el("div", { className: "action-sheet", role: "dialog", "aria-label": "Меню" }, [
    el("button", { type: "button", className: "backdrop", "aria-label": "Закрыть", onClick: close }),
    el("div", { className: "action-sheet__panel" }, [
      el("h3", { className: "action-sheet__title", text: "Настройки" }),
      el("button", {
        type: "button",
        className: "action-sheet__item",
        text: state.showInstructor ? "Скрыть подсказки преподавателю" : "Для преподавателя",
        onClick: () => {
          state.showInstructor = !state.showInstructor;
          persist();
          close();
        },
      }),
      el("button", {
        type: "button",
        className: "action-sheet__item",
        text: getTheme() === "dark" ? "Светлая тема" : "Тёмная тема",
        onClick: () => {
          setTheme(getTheme() === "dark" ? "light" : "dark");
          close();
        },
      }),
      el("button", {
        type: "button",
        className: "action-sheet__item",
        text: "Печать урока",
        onClick: () => {
          close();
          window.print();
        },
      }),
      el("button", {
        type: "button",
        className: "action-sheet__item action-sheet__item--danger",
        text: "Сбросить прогресс",
        onClick: () => {
          close();
          resetProgress();
        },
      }),
    ]),
  ]);
}

function renderBottomBar() {
  const found = findLesson(state.activeLessonId);
  const lesson = found?.lesson;
  const stepIndex = lesson ? Math.min(state.stepIndex, lesson.steps.length - 1) : 0;
  const atStart = stepIndex === 0 && allLessons()[0]?.id === lesson?.id;

  return el("nav", { className: "bottom-bar", "aria-label": "Быстрая навигация" }, [
    el("button", {
      type: "button",
      className: "bottom-bar__btn",
      text: "Содержание",
      onClick: () => {
        state.actionsOpen = false;
        state.sidebarOpen = true;
        render();
      },
    }),
    el("button", {
      type: "button",
      className: "bottom-bar__btn",
      text: "Назад",
      disabled: atStart,
      onClick: prevStep,
    }),
    el("button", {
      type: "button",
      className: "bottom-bar__btn bottom-bar__btn--primary",
      text: "Дальше",
      onClick: nextStep,
    }),
    el("button", {
      type: "button",
      className: "bottom-bar__btn",
      text: state.helpOpen ? "Скрыть" : "Шпаргалка",
      onClick: () => {
        state.helpOpen = !state.helpOpen;
        persist();
        render();
        requestAnimationFrame(() => {
          document.querySelector(".help-mobile")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      },
    }),
  ]);
}

function renderHeader() {
  return el("header", { className: "header" }, [
    el("button", {
      type: "button",
      className: "header__icon-btn header__icon-btn--menu",
      "aria-label": "Открыть содержание",
      text: "☰",
      onClick: () => {
        state.actionsOpen = false;
        state.sidebarOpen = true;
        render();
      },
    }),
    el("div", { className: "header__brand" }, [
      el("span", { className: "header__logo", text: "R" }),
      el("div", { className: "header__brand-text" }, [
        el("div", { className: "header__title", text: COURSE.title }),
        el("div", { className: "header__sub", text: "Путеводитель для занятий" }),
      ]),
    ]),
    el("button", {
      type: "button",
      className: "header__icon-btn header__icon-btn--more",
      "aria-label": "Меню настроек",
      text: "⋯",
      onClick: () => {
        state.sidebarOpen = false;
        state.actionsOpen = !state.actionsOpen;
        render();
      },
    }),
    el("div", { className: "header__actions header__actions--desktop" }, [
      el("button", {
        type: "button",
        className: "btn btn--ghost btn--sm",
        text: state.showInstructor ? "Скрыть для преподавателя" : "Для преподавателя",
        onClick: () => {
          state.showInstructor = !state.showInstructor;
          persist();
          render();
        },
      }),
      el("button", {
        type: "button",
        className: "btn btn--ghost btn--sm",
        text: getTheme() === "dark" ? "Светлая тема" : "Тёмная тема",
        onClick: () => {
          setTheme(getTheme() === "dark" ? "light" : "dark");
          render();
        },
      }),
      el("button", {
        type: "button",
        className: "btn btn--ghost btn--sm",
        text: "Печать",
        onClick: () => window.print(),
      }),
      el("button", {
        type: "button",
        className: "btn btn--ghost btn--sm",
        text: "Сброс прогресса",
        onClick: resetProgress,
      }),
    ]),
    el("div", { className: "header__progress" }, [
      el("div", { className: "header__bar" }, [
        el("div", { className: "header__fill", style: `width:${overallProgress().pct}%` }),
      ]),
      el("span", { text: `${overallProgress().pct}% курса` }),
    ]),
  ]);
}

function render() {
  const app = document.getElementById("app");
  if (!state.seenWelcome) {
    app.replaceChildren(renderWelcome());
    syncBodyUiLock();
    return;
  }

  app.replaceChildren(
    el("div", { className: "shell" }, [
      renderHeader(),
      el("div", { className: "shell__body" }, [
        state.sidebarOpen || state.actionsOpen
          ? el("button", {
              type: "button",
              className: "backdrop",
              "aria-label": "Закрыть меню",
              onClick: () => {
                closeOverlays();
                render();
              },
            })
          : null,
        renderOutline(),
        el("div", { className: "shell__main" }, [renderLesson(), renderHelpMobile()]),
        renderHelpPanel(),
      ]),
      renderActionSheet(),
      renderBottomBar(),
      el("footer", { className: "site-foot" }, [
        el("span", {
          text: "Материал для занятий по эконометрике. Код выполняется в RStudio на компьютере.",
        }),
      ]),
    ]),
  );
  syncBodyUiLock();
}

document.addEventListener("keydown", (e) => {
  if (!state.seenWelcome) return;
  if (e.target.matches("textarea, input")) return;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    nextStep();
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    prevStep();
  }
});

load();
render();
