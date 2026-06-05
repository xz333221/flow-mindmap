import { createApp } from 'vue'
import MindMap from './components/MindMap.vue'
import type { MindMapNode } from './types'

// ensure host fills viewport
const style = document.createElement('style')
style.textContent = `html,body,#app{margin:0;height:100%;width:100%;}#app{display:flex;}`
document.head.appendChild(style)

const initialData: MindMapNode = {
  id: 'root',
  text: 'z-mind 思维导图',
  children: [
    {
      id: 'n_features',
      text: '核心功能',
      children: [
        { id: 'n_f1', text: '节点增删改', children: [] },
        { id: 'n_f2', text: '拖拽布局', children: [] },
        { id: 'n_f3', text: '缩放与平移', children: [] },
        { id: 'n_f4', text: '键盘快捷键', children: [] },
      ],
    },
    {
      id: 'n_tech',
      text: '技术栈',
      children: [
        { id: 'n_t1', text: 'Vue 3 + Vite', children: [] },
        { id: 'n_t2', text: 'TypeScript', children: [] },
        { id: 'n_t3', text: '纯 SVG 渲染', children: [] },
      ],
    },
    {
      id: 'n_open',
      text: '开源',
      children: [
        { id: 'n_o1', text: 'MIT 协议', children: [] },
        { id: 'n_o2', text: '可作为 npm 组件使用', children: [] },
      ],
    },
  ],
}

createApp(MindMap, { data: initialData }).mount('#app')
