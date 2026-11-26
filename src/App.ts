import { el, Match, onCleanup, onMount, Show, Switch } from '@samrey/runtime';
import { ChatView } from './components/ChatView.ts';
import { ProjectsView } from './components/ProjectsView.ts';
import { SettingsView } from './components/SettingsView.ts';
import { Sidebar } from './components/Sidebar.ts';
import { TopBar } from './components/TopBar.ts';
import {
  activeViewSignal,
  refreshConnection,
  sidebarOpenMobileSignal,
  startNewChat,
} from './store/workspaceStore.ts';

export function App(): HTMLElement {
  onMount(() => {
    void refreshConnection();

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  return el(
    'div',
    { class: 'h-screen w-full overflow-hidden flex bg-[#0B0D11] text-[#E6E9EF]' },
    // Mobile sidebar backdrop
    Show({
      when: () => sidebarOpenMobileSignal.value,
      children: () =>
        el('div', {
          class: 'fixed inset-0 z-30 bg-black/60 lg:hidden',
          onClick: () => {
            sidebarOpenMobileSignal.value = false;
          },
          'aria-hidden': 'true',
        }),
    }),

    // Left Sidebar
    Sidebar(),

    // Main Column
    el(
      'main',
      { class: 'flex-1 flex flex-col min-w-0 min-h-0' },
      TopBar(),
      Switch({
        children: [
          Match({
            when: () => activeViewSignal.value === 'projects',
            children: () => ProjectsView(),
          }),
          Match({
            when: () => activeViewSignal.value === 'settings',
            children: () => SettingsView(),
          }),
          Match({
            when: () => activeViewSignal.value === 'chat',
            children: () => ChatView(),
          }),
        ],
        fallback: () => ChatView(),
      })
    )
  );
}
