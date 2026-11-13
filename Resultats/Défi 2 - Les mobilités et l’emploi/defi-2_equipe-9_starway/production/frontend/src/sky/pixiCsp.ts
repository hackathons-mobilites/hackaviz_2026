/**
 * PixiJS v8 sans 'unsafe-eval' : ce module remplace la génération de code au runtime
 * (new Function) par des implémentations statiques. Importé AVANT le moteur du ciel, il permet
 * une Content-Security-Policy stricte (voir public/staticwebapp.config.json).
 */
import 'pixi.js/unsafe-eval';
