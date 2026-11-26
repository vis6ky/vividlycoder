import { computed, signal } from '@samrey/reactivity';
import { el, For, Show } from '@samrey/runtime';
import {
  activeProjectIdSignal,
  activeViewSignal,
  backendStatusSignal,
  createProject,
  projectsErrorSignal,
  projectsLoadingSignal,
  projectsSignal,
  refreshConnection,
  setActiveProject,
} from '../store/workspaceStore.ts';
import { AlertIcon, FolderIcon, PlusIcon, RefreshIcon } from './Icons.ts';

export function ProjectsView(): HTMLElement {
  const nameInput = signal('');
  const pathInput = signal('');
  const languageInput = signal('TypeScript');
  const formError = signal<string | null>(null);
  const submitting = signal(false);

  const projectIds = computed(() => projectsSignal.value.map((p) => p.id));

  const handleAddProject = async (e: Event) => {
    e.preventDefault();
    formError.value = null;
    const name = nameInput.value.trim();
    const path = pathInput.value.trim();
    const language = languageInput.value.trim();

    if (!name || !path) {
      formError.value = 'Both project name and local macOS directory path are required.';
      return;
    }

    submitting.value = true;
    const ok = await createProject({ name, path, language: language || undefined });
    submitting.value = false;

    if (ok) {
      nameInput.value = '';
      pathInput.value = '';
    } else {
      formError.value = projectsErrorSignal.value || 'Failed to register project.';
    }
  };

  return el(
    'section',
    { class: 'flex-1 overflow-y-auto bg-[#0B0D11]' },
    el(
      'div',
      { class: 'max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8' },
      // Header
      el(
        'div',
        { class: 'flex flex-wrap items-start justify-between gap-4 border-b border-[#ffffff0d] pb-5' },
        el(
          'div',
          { class: 'space-y-1' },
          el('h1', { class: 'text-xl font-semibold text-[#F9FAFB]' }, 'Projects'),
          el(
            'p',
            { class: 'text-sm text-[#9CA3AF]' },
            'Register local macOS workspace directories in SQLite via your FastAPI backend. Phase 1 binds project metadata without modifying local files.'
          )
        ),
        el(
          'button',
          {
            type: 'button',
            onClick: () => void refreshConnection(),
            class:
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#ffffff14] bg-[#141820] hover:bg-[#1A1F29] text-xs font-medium text-[#D1D5DB] transition-colors whitespace-nowrap shrink-0',
          },
          RefreshIcon('w-3.5 h-3.5'),
          'Sync Projects'
        )
      ),

      // Register Project Form
      el(
        'form',
        {
          onSubmit: handleAddProject,
          class: 'rounded-lg border border-[#ffffff12] bg-[#11141B] p-5 space-y-4',
        },
        el(
          'div',
          { class: 'flex items-center justify-between gap-4' },
          el('h2', { class: 'text-sm font-semibold text-[#F3F4F6]' }, 'Register Local Directory'),
          Show({
            when: () => backendStatusSignal.value !== 'connected',
            children: () =>
              el(
                'span',
                { class: 'text-xs text-[#F59E0B] font-mono' },
                'Requires active FastAPI connection'
              ),
          })
        ),
        el(
          'div',
          { class: 'grid grid-cols-1 sm:grid-cols-3 gap-3' },
          el(
            'div',
            { class: 'space-y-1.5' },
            el('label', { for: 'proj-name', class: 'block text-xs text-[#9CA3AF]' }, 'Project Name'),
            el('input', {
              id: 'proj-name',
              type: 'text',
              placeholder: 'vividcoder-backend',
              value: () => nameInput.value,
              onInput: (e: Event) => {
                nameInput.value = (e.target as HTMLInputElement).value;
              },
              class:
                'w-full rounded-md border border-[#ffffff14] bg-[#141820] px-3 py-2 text-sm text-[#E6E9EF] placeholder-[#6B7280] focus:outline-none focus:border-[#3B82F6]',
            })
          ),
          el(
            'div',
            { class: 'space-y-1.5 sm:col-span-2' },
            el(
              'label',
              { for: 'proj-path', class: 'block text-xs text-[#9CA3AF]' },
              'Local macOS Path'
            ),
            el('input', {
              id: 'proj-path',
              type: 'text',
              placeholder: '/Users/username/Developer/vividcoder-backend',
              value: () => pathInput.value,
              onInput: (e: Event) => {
                pathInput.value = (e.target as HTMLInputElement).value;
              },
              class:
                'w-full rounded-md border border-[#ffffff14] bg-[#141820] px-3 py-2 text-sm font-mono text-[#E6E9EF] placeholder-[#6B7280] focus:outline-none focus:border-[#3B82F6]',
            })
          )
        ),
        el(
          'div',
          { class: 'flex flex-wrap items-end justify-between gap-3' },
          el(
            'div',
            { class: 'w-48 space-y-1.5' },
            el('label', { for: 'proj-lang', class: 'block text-xs text-[#9CA3AF]' }, 'Primary Stack'),
            el('input', {
              id: 'proj-lang',
              type: 'text',
              placeholder: 'Python / FastAPI',
              value: () => languageInput.value,
              onInput: (e: Event) => {
                languageInput.value = (e.target as HTMLInputElement).value;
              },
              class:
                'w-full rounded-md border border-[#ffffff14] bg-[#141820] px-3 py-2 text-sm text-[#E6E9EF] placeholder-[#6B7280] focus:outline-none focus:border-[#3B82F6]',
            })
          ),
          el(
            'button',
            {
              type: 'submit',
              disabled: () => submitting.value || backendStatusSignal.value !== 'connected',
              class: () =>
                submitting.value || backendStatusSignal.value !== 'connected'
                  ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-[#1F2633] text-[#6B7280] cursor-not-allowed whitespace-nowrap'
                  : 'inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white transition-colors whitespace-nowrap cursor-pointer',
            },
            PlusIcon('w-3.5 h-3.5'),
            () => (submitting.value ? 'Registering...' : 'Register Project')
          )
        ),
        Show({
          when: () => Boolean(formError.value),
          children: () =>
            el('p', { class: 'text-xs text-[#EF4444]' }, () => formError.value ?? ''),
        })
      ),

      // Projects List State Machine (Loading / Error / Empty / Populated)
      el(
        'div',
        { class: 'space-y-3' },
        el(
          'div',
          { class: 'flex items-center justify-between' },
          el('h2', { class: 'text-sm font-semibold text-[#F3F4F6]' }, 'Registered Workspaces'),
          el(
            'span',
            { class: 'text-xs font-mono tabular-nums text-[#6B7280]' },
            () => `${projectsSignal.value.length} total`
          )
        ),
        Show({
          when: () => projectsLoadingSignal.value,
          children: () =>
            el(
              'div',
              { class: 'space-y-2.5' },
              [1, 2, 3].map(() =>
                el('div', {
                  class: 'h-16 rounded-lg border border-[#ffffff0a] bg-[#141820]',
                })
              )
            ),
          fallback: () =>
            Show({
              when: () => Boolean(projectsErrorSignal.value) && projectsSignal.value.length === 0,
              children: () =>
                el(
                  'div',
                  {
                    class:
                      'rounded-lg border border-[#ffffff12] bg-[#141820] p-5 flex items-start gap-3',
                  },
                  AlertIcon('w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5'),
                  el(
                    'div',
                    { class: 'space-y-2' },
                    el(
                      'p',
                      { class: 'text-sm font-medium text-[#F3F4F6]' },
                      'Projects unavailable while local FastAPI is offline'
                    ),
                    el(
                      'p',
                      { class: 'text-xs text-[#9CA3AF] leading-relaxed' },
                      () => projectsErrorSignal.value ?? ''
                    ),
                    el(
                      'div',
                      { class: 'flex items-center gap-3 pt-1' },
                      el(
                        'button',
                        {
                          type: 'button',
                          onClick: () => void refreshConnection(),
                          class:
                            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1F2633] border border-[#ffffff14] text-xs font-medium text-[#E6E9EF] hover:bg-[#273040]',
                        },
                        RefreshIcon('w-3.5 h-3.5'),
                        'Retry'
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          onClick: () => {
                            activeViewSignal.value = 'settings';
                          },
                          class: 'text-xs font-medium text-[#60A5FA] hover:underline',
                        },
                        'Backend Settings'
                      )
                    )
                  )
                ),
              fallback: () =>
                For({
                  each: () => projectIds.value,
                  key: (id) => id,
                  fallback: () =>
                    el(
                      'div',
                      {
                        class:
                          'rounded-lg border border-[#ffffff10] bg-[#11141B] p-8 text-center space-y-2',
                      },
                      FolderIcon('w-6 h-6 text-[#6B7280] mx-auto'),
                      el(
                        'p',
                        { class: 'text-sm font-medium text-[#E6E9EF]' },
                        'No projects registered yet'
                      ),
                      el(
                        'p',
                        { class: 'text-xs text-[#9CA3AF]' },
                        'Add a local repository path above once your FastAPI server is connected.'
                      )
                    ),
                  children: (projId) => {
                    const projSig = computed(() =>
                      projectsSignal.value.find((p) => p.id === projId)
                    );
                    return el(
                      'div',
                      {
                        class: () =>
                          `flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg border transition-colors ${
                            activeProjectIdSignal.value === projId
                              ? 'border-[#3B82F6]/60 bg-[#141820]'
                              : 'border-[#ffffff10] bg-[#11141B] hover:border-[#ffffff1e]'
                          }`,
                      },
                      el(
                        'div',
                        { class: 'min-w-0 space-y-1' },
                        el(
                          'div',
                          { class: 'flex items-center gap-2' },
                          FolderIcon('w-4 h-4 text-[#3B82F6] shrink-0'),
                          el(
                            'span',
                            { class: 'text-sm font-semibold text-[#F3F4F6] truncate' },
                            () => projSig.value?.name ?? ''
                          )
                        ),
                        el(
                          'div',
                          {
                            class:
                              'flex flex-wrap items-center gap-2 text-xs text-[#9CA3AF] font-mono',
                          },
                          el('span', { class: 'truncate' }, () => projSig.value?.path ?? ''),
                          el('span', { 'aria-hidden': 'true', class: 'text-[#4B5563]' }, '·'),
                          el('span', null, () => projSig.value?.language || 'General')
                        )
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          onClick: () => {
                            setActiveProject(projId);
                            activeViewSignal.value = 'chat';
                          },
                          class:
                            'px-3.5 py-1.5 rounded-md border border-[#ffffff14] bg-[#1A1F29] hover:bg-[#232A38] text-xs font-medium text-[#E6E9EF] transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                        },
                        () =>
                          activeProjectIdSignal.value === projId
                            ? 'Active · Open Chat'
                            : 'Select Workspace'
                      )
                    );
                  },
                }),
            }),
        })
      )
    )
  );
}
