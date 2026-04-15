import DefaultTheme from 'vitepress/theme'
import './custom.css'
import NoteComposer from '../../components/NoteComposer.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('NoteComposer', NoteComposer)
  }
}
