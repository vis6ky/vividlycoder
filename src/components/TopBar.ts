import { computed, effect } from '@samrey/reactivity';
import { el, For, onMount } from '@samrey/runtime';
import {
  activeProjectIdSignal,
  activeViewSignal,
  activityStateSignal,
  configSignal,
  modelsSignal,
  projectsSignal,
  selectedModelSignal,
  setActiveProject,
  sidebarOpenMobileSignal,
} from '../store/workspaceStore.ts';
import type { ActivityState } from '../types/vividcoder.ts';
import { MenuIcon } from './Icons.ts';

function activityMeta(state: ActivityState): { label: string; dotClass: string; textClass: string } {
  switch (state) {
    case 'connecting':
      return {
        label: 'Connecting',
        dotClass: 'w-2 h-2 rounded-full bg-[#F59E0B]',
        textClass: 'text-[#F59E0B]',
      };
    case 'streaming':
      return {
        label: 'Streaming',
        dotClass: 'w-2 h-2 rounded-full bg-[#3B82F6]',
        textClass: 'text-[#60A5FA]',
      };
    case 'loading':
      return {
        label: 'Loading',
        dotClass: 'w-2 h-2 rounded-full bg-[#F59E0B]',
        textClass: 'text-[#F59E0B]',
      };
    case 'error':
      return {
        label: 'Error',
        dotClass: 'w-2 h-2 rounded-full bg-[#EF4444]',
        textClass: 'text-[#EF4444]',
      };
    default:
      return {
        label: 'Idle',
        dotClass: 'w-2 h-2 rounded-full bg-[#6B7280]',
        textClass: 'text-[#9CA3AF]',
      };
  }
}

export function TopBar(): HTMLElement {
  const modelOptions = computed<string[]>(() => {
    const names = new Set<string>();
    names.add(configSignal.value.defaultModel || 'qwen3.5:4b');
    for (const m of modelsSignal.value) {
      names.add(m.name);
    }
    if (selectedModelSignal.value) {
      names.add(selectedModelSignal.value);
    }
    return Array.from(names);
  });

  const projectIds = computed(() => projectsSignal.value.map((p) => p.id));

  const projectSelect = el(
    'select',
    {
      id: 'vc-project-select',
      'aria-label': 'Select active project',
      onChange: (e: Event) => {
        const val = (e.target as HTMLSelectElement).value;
        setActiveProject(val || null);
      },
      class:
        'max-w-[190px] sm:max-w-[240px] truncate rounded-md border border-[#ffffff14] bg-[#141820] px-2.5 py-1.5 text-xs font-medium text-[#E6E9EF] focus:outline-none focus:border-[#3B82F6]',
    },
    el('option', { value: '' }, 'All Workspaces'),
    For({
      each: () => projectIds.value,
      key: (id) => id,
      children: (id) => {
        const proj = computed(() => projectsSignal.value.find((p) => p.id === id));
        return el('option', { value: id }, () => proj.value?.name ?? id);
      },
    })
  ) as HTMLSelectElement;

  const modelSelect = el(
    'select',
    {
      id: 'vc-model-select',
      'aria-label': 'Select Ollama coding model',
      onChange: (e: Event) => {
        selectedModelSignal.value = (e.target as HTMLSelectElement).value;
      },
      class:
        'max-w-[165px] sm:max-w-[220px] truncate rounded-md border border-[#ffffff14] bg-[#141820] px-2.5 py-1.5 text-xs font-mono text-[#E6E9EF] focus:outline-none focus:border-[#3B82F6]',
    },
    For({
      each: () => modelOptions.value,
      key: (name) => name,
      children: (name) => el('option', { value: name }, name),
    })
  ) as HTMLSelectElement;

  onMount(() => {
    effect(() => {
      void projectIds.value;
      projectSelect.value = activeProjectIdSignal.value ?? '';
    });
    effect(() => {
      void modelOptions.value;
      modelSelect.value = selectedModelSignal.value;
    });
  });

  return el(
    'header',
    {
      class:
        'h-14 px-4 sm:px-6 border-b border-[#ffffff10] bg-[#0B0D11] flex items-center justify-between gap-4 shrink-0',
    },
    // Left: Mobile menu + Project Selector
    el(
      'div',
      { class: 'flex items-center gap-3 min-w-0' },
      el(
        'button',
        {
          type: 'button',
          onClick: () => {
            sidebarOpenMobileSignal.value = !sidebarOpenMobileSignal.value;
          },
          'aria-label': 'Toggle sidebar navigation',
          class:
            'lg:hidden p-2 -ml-2 rounded-md text-[#9CA3AF] hover:text-white hover:bg-[#141820]',
        },
        MenuIcon('w-5 h-5')
      ),
      el(
        'div',
        { class: 'flex items-center gap-2 min-w-0' },
        el(
          'label',
          {
            for: 'vc-project-select',
            class: 'hidden sm:inline text-xs text-[#6B7280] whitespace-nowrap',
          },
          'Project'
        ),
        projectSelect
      ),
      el(
        'button',
        {
          type: 'button',
          onClick: () => {
            activeViewSignal.value = 'projects';
          },
          class:
            'hidden md:inline-block text-xs text-[#6B7280] hover:text-[#D1D5DB] transition-colors whitespace-nowrap shrink-0',
        },
        'Manage'
      )
    ),

    // Right: Model Selector + Activity Indicator
    el(
      'div',
      { class: 'flex items-center gap-3 sm:gap-4 shrink-0' },
      el(
        'div',
        { class: 'flex items-center gap-2' },
        el(
          'label',
          {
            for: 'vc-model-select',
            class: 'hidden sm:inline text-xs text-[#6B7280] whitespace-nowrap',
          },
          'Model'
        ),
        modelSelect
      ),

      el('div', { class: 'h-4 w-px bg-[#ffffff12]', 'aria-hidden': 'true' }),

      // Activity Indicator
      el(
        'div',
        {
          class: 'flex items-center gap-2 text-xs font-mono whitespace-nowrap shrink-0',
          'aria-live': 'polite',
        },
        el('span', { class: () => activityMeta(activityStateSignal.value).dotClass }),
        el(
          'span',
          { class: () => activityMeta(activityStateSignal.value).textClass },
          () => activityMeta(activityStateSignal.value).label
        )
      )
    )
  );
}
