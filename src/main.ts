import { createApp } from 'vue'
import App from './App.vue'

// ensure host fills viewport
const style = document.createElement('style')
style.textContent = `html,body,#app{margin:0;height:100%;width:100%;}#app{display:flex;}`
document.head.appendChild(style)

createApp(App).mount('#app')
