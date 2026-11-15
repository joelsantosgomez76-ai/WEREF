/* Aviso en consola cuando la politica de seguridad (CSP) bloquea algo. Sin esto no se ve por que falla una carga. */
document.addEventListener('securitypolicyviolation', function(e){ console.warn('CSP bloqueó:', e.violatedDirective, e.blockedURI); });
