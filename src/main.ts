import { mount } from '@samrey/runtime';
import { App } from './App.ts';
import './index.css';

const root = document.getElementById('root');
if (root) {
  mount(() => App(), root);
}
