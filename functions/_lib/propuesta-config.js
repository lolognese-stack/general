// GENERADO por crm/generar-config-propuesta.mjs desde luna-llena-propuestas/config.json: no editar a mano.
// Contenido fijo de la plantilla de propuesta (quiénes somos, cómo reservar, medios de pago, cancelación, FAQ,
// testimonios por tag, términos). null o [] = falta: se ve como placeholder solo en la vista previa.
export const CONFIG_PROPUESTA = {
  "agencia": {
    "nombre": "Luna Llena Travel",
    "razonSocial": "Full Moon Travel Agency EIRL",
    "ruc": "20603319428",
    "direccion": "Calle Chihuampata 543, San Blas, Cusco",
    "whatsapp": "51982360927",
    "whatsappOtros": [
      "51930299443"
    ],
    "emails": [
      "reservas@lunallenatravel.com",
      "info@lunallenatravel.com"
    ],
    "confianza": [
      {
        "cifra": "+1000",
        "texto": "viajeros ya recorrieron Perú con nosotros"
      },
      {
        "cifra": "+8",
        "texto": "años armando viajes por Perú"
      },
      {
        "icono": "escudo",
        "texto": "Agencia registrada en Perú · RUC {ruc}"
      }
    ]
  },
  "sitio": "https://luna-llena-propuestas.vercel.app",
  "calcomUrl": null,
  "terminos": {
    "url": "/terminos/",
    "version": "2026-11-11"
  },
  "pago": {
    "reservaOnline": false,
    "señaPorcentaje": 50,
    "saldoCuando": "al llegar a Cusco",
    "recargoTarjeta": 5,
    "igvFactura": 18,
    "minimoPasajeros": 2,
    "mediosDePago": [
      {
        "id": "visa",
        "nombre": "Visa",
        "logo": "/_venta/pagos/visa.webp"
      },
      {
        "id": "mastercard",
        "nombre": "Mastercard",
        "logo": "/_venta/pagos/mastercard.webp"
      },
      {
        "id": "diners",
        "nombre": "Diners Club",
        "logo": "/_venta/pagos/diners.webp"
      },
      {
        "id": "amex",
        "nombre": "American Express",
        "logo": "/_venta/pagos/amex.webp"
      },
      {
        "id": "westernunion",
        "nombre": "Western Union",
        "logo": "/_venta/pagos/westernunion.webp"
      },
      {
        "id": "paypal",
        "nombre": "PayPal",
        "logo": "/_venta/pagos/paypal.webp"
      },
      {
        "id": "remitly",
        "nombre": "Remitly",
        "logo": "/_venta/pagos/remitly.webp"
      },
      {
        "id": "plin",
        "nombre": "Plin",
        "logo": "/_venta/pagos/plin.webp"
      },
      {
        "id": "yape",
        "nombre": "Yape",
        "logo": "/_venta/pagos/yape.webp"
      }
    ],
    "linkDePago": null,
    "transferencia": null
  },
  "cancelacion": {
    "texto": "Las cancelaciones por parte de “EL CLIENTE” con o sin causa justificada serán admitidas por “LA EMPRESA”, siempre y cuando se realicen 20 días antes de la fecha del viaje, excepto los programas de Treckking (caminatas) que deberán ser 30 días antes.",
    "devoluciones": "Las devoluciones se realizarán por parte de “LA EMPRESA” en un plazo no mayor a 30 días calendarios a partir de la respuesta emitida por el área administrativa, la devolución se realizará por el mismo medio que “EL CLIENTE” realizo el pago."
  },
  "faq": [
    {
      "id": "soroche",
      "pregunta": "¿Me va a afectar la altura (soroche)?",
      "respuesta": "El mal de altura o soroche es un malestar natural al visitar regiones de altura; los síntomas principales son el dolor de cabeza y la fatiga. Se recomienda habituarse a Cusco al menos 1 o 2 días antes de las excursiones de altura (la Laguna Humantay está a 4.200 m y la Montaña de Colores a 5.200 m), beber abundante agua y tomar mate de coca. En esos tours van balón de oxígeno, mantas térmicas y botiquín de primeros auxilios. Los adultos mayores que no están acostumbrados a caminar deben consultar con su médico.",
      "todo": null,
      "fuente": "fichas Montaña de 7 Colores (preguntas 3 y 8) y Laguna Humantay (aclimatación, incluye)"
    },
    {
      "id": "seguridad",
      "pregunta": "¿Es seguro el viaje?",
      "respuesta": "Cusco es un destino seguro. Operamos nuestros propios tours, sin delegarlos a otra agencia, en mini vans autorizadas para servicio turístico de 12 pasajeros como máximo, con personal capacitado para cada ruta y monitoreo de los pasajeros en todo momento. El sobrevuelo de Nazca se hace en avionetas Cessna 207 que cumplen los estándares de mantenimiento y seguridad. Para las actividades que implican riesgo se firma un descargo de responsabilidad antes de realizarlas.",
      "todo": null,
      "fuente": "ficha City Tour Cusco (pregunta 4), presupuesto-ulises.xlsx (TRANSPORTE, STAFF), ficha Machu Picchu (operadores), ficha Sobrevuelo Nazca, términos (primer párrafo)"
    },
    {
      "id": "lluvia",
      "pregunta": "¿Qué pasa si llueve o se cancela un tour?",
      "respuesta": "La agencia está obligada a cumplir todos los servicios del itinerario. Si por circunstancias ajenas a la agencia (fenómenos naturales, conflictos sociales o hechos de terceros) hay cambios de itinerario, de horarios o cancelaciones, la agencia no asume los costos de esa eventualidad. Si el clima no permite el tour a las Islas Ballestas, se da un servicio equivalente en su reemplazo. La agencia puede cambiar el orden de los servicios para su mejor desarrollo, respetando la cantidad y la calidad contratadas y con tu conformidad. Para la lluvia se recomienda llevar casaca impermeable; en el tour de cuatrimotos el equipo para la lluvia está incluido.",
      "todo": null,
      "fuente": "términos (CANCELACIONES y MODIFICACIÓN DEL ORDEN), ficha Norte Maravilloso (condiciones), fichas con recomendaciones, ficha Cuatrimotos (incluye)"
    },
    {
      "id": "pago-exterior",
      "pregunta": "¿Cómo pago desde el exterior?",
      "respuesta": "Para reservar se paga el {seña}% del total y el saldo {saldoCuando}. Aceptamos tarjetas Visa, Mastercard, Diners Club y American Express, PayPal, Western Union y Remitly; si estás en Perú, también Yape y Plin. Puedes pagar en soles o su equivalente en dólares según el tipo de cambio vigente; con tarjeta se suma un {recargoTarjeta}%. Los cargos de bancos, tarjetas u otros intermediarios corren por tu cuenta: la agencia reconoce el monto que llega a su cuenta. Si necesitas factura, se suma el {igvFactura}% de IGV.",
      "todo": null,
      "fuente": "presupuesto-ulises.xlsx (RESERVA, MODO DE PAGO), términos (PAGO DE DEPÓSITO), ficha Norte Maravilloso (IGV), imagen de medios de pago (12/11/2026)"
    },
    {
      "id": "efectivo",
      "pregunta": "¿Cuánto efectivo llevo para extras?",
      "respuesta": "Algunos pagos se hacen en el lugar y no están en la tarifa, según el itinerario. Por ejemplo: impuesto de sobrevuelo TUUA y boleto turístico parcial de Nazca (S/ 77 por persona), entrada a la Montaña de Colores (S/ 25 para extranjeros), caballo opcional en la Montaña (unos S/ 100), baños en el camino (S/ 1), entrada opcional a la Catedral del Cusco (S/ 40), paseo opcional en caballitos de totora (S/ 15), entrada a la Laguna Humantay, tasas de ingreso a Huacachina e Islas Ballestas, ingreso a los baños termales de Aguas Calientes y las comidas que no incluye cada tour.",
      "todo": "Monto total recomendado en efectivo; precio de la entrada a la Laguna Humantay y de las tasas de Huacachina e Islas Ballestas.",
      "fuente": "fichas Sobrevuelo Nazca, Montaña de 7 Colores (preguntas 1, 2 y 6), City Tour Cusco, Puno Místico, Laguna Humantay, Norte Maravilloso, Machu Picchu (no incluye)"
    },
    {
      "id": "propinas",
      "pregunta": "¿Hay que dejar propinas?",
      "respuesta": null,
      "todo": "No figura en ningún documento de la agencia.",
      "fuente": null
    },
    {
      "id": "seguro",
      "pregunta": "¿Necesito seguro de viaje?",
      "respuesta": "El tour en cuatrimotos indica que no incluye seguro contra accidentes. Para las actividades que implican riesgo se firma un descargo de responsabilidad antes de realizarlas.",
      "todo": "Si la agencia recomienda o exige un seguro de viaje, y cuál.",
      "fuente": "ficha Cuatrimotos (no incluye), términos (primer párrafo)"
    },
    {
      "id": "cambiar-fechas",
      "pregunta": "¿Puedo cambiar las fechas?",
      "respuesta": "Sí. Puedes modificar tu itinerario hasta 15 días antes del viaje, previa verificación de disponibilidad. Si el cambio genera penalidades con los proveedores, esos montos corren por tu cuenta.",
      "todo": null,
      "fuente": "términos (MODIFICACIÓN DEL ORDEN DE LOS SERVICIOS CONTRATADOS)"
    },
    {
      "id": "vuelos",
      "pregunta": "¿Los vuelos internos están incluidos?",
      "respuesta": "Los vuelos internos no están incluidos en la tarifa y se cotizan aparte. Los traslados entre el aeropuerto y el hotel sí están incluidos cuando figuran en tu itinerario.",
      "todo": "Cómo se cotizan y compran los vuelos internos (los compra la agencia o el pasajero) y montos de referencia.",
      "fuente": "presupuesto-ulises.xlsx (traslados a aeropuertos de Lima y Cusco, sin vuelo cotizado)"
    },
    {
      "id": "documentos",
      "pregunta": "¿Qué documentos necesito?",
      "respuesta": "Tu pasaporte original: con él se reservan las entradas a Machu Picchu y se presenta en el control de la ciudadela, junto con el carnet de estudiante ISIC original si corresponde. Los pasaportes, visas, permisos sanitarios y vacunas que pidan Perú y los países de tránsito corren por tu cuenta.",
      "todo": null,
      "fuente": "ficha Machu Picchu (segundo día y recomendaciones), términos (DOCUMENTACIÓN, VISAS Y PERMISOS)"
    }
  ],
  "testimonios": [
    {
      "id": "koyi",
      "tags": [
        "cusco"
      ],
      "t": "Una experiencia que rompe esquemas",
      "p": "Desde tours privados y un chofer dedicado hasta almuerzos gourmet servidos en medio de los Andes, estuvimos completamente consentidos. El itinerario también fue cuidadosamente diseñado para ayudar con la aclimatación de altitud. […] La compañía Luna llena Travel es de propiedad local, y se nota en el orgullo y cuidado de todos los que conocimos.",
      "n": "Koyi K",
      "f": "dic. 2025",
      "src": "Traducida del inglés · Reseña en TripAdvisor"
    },
    {
      "id": "midori",
      "tags": [
        "machu-picchu",
        "cusco"
      ],
      "t": "Muchas gracias a todos los chicos de Luna Llena",
      "p": "Me encantó el itinerario que me brindaron de principio a fin, el tour de 02 días a Machupicchu fue mágico, nuestro guía Cristian un señor profesional que nos enganchó a mis hijos y papás, que es difícil de lograr […] nos trataron de lujo. Muchas gracias Álvaro por tu paciencia y tu predisposición.",
      "n": "Midori Carrillo",
      "f": "Cali, Colombia · ago. 2024",
      "src": "Reseña en TripAdvisor"
    },
    {
      "id": "victor",
      "tags": [
        "valle-sagrado",
        "machu-picchu",
        "cusco"
      ],
      "t": "Entre montañas sagradas y sueños cumplidos",
      "p": "La experiencia del itinerario Valle Sagrado y Machu Picchu fue simplemente increíble. Todo estuvo muy bien organizado, con guías profesionales, tiempos adecuados y una atención cálida en cada momento. Totalmente recomendada para conocer Cusco y Machu Picchu sin preocupaciones.",
      "n": "victor O",
      "f": "jun. 2025 · Amigos",
      "src": "Reseña en TripAdvisor"
    },
    {
      "id": "maria",
      "tags": [
        "choquequirao",
        "trekking"
      ],
      "t": "Caminata y aventura para llegar a Choquequirao",
      "p": "La caminata fue desafiante pero preciosa. Estaba muy bien organizado y estamos contentos de haber reservado con Luna Llena: nuestro guía Álvaro nos cuidó muy bien, era amable, bien informado y servicial, ¡con mucha paciencia! […] La comida peruana que nos preparó nuestro cocinero Ernesto fue deliciosa y abundante. ¡Ha sido una gran aventura!",
      "n": "Maria C",
      "f": "dic. 2025 · Parejas",
      "src": "Traducida del inglés · Reseña en TripAdvisor"
    },
    {
      "id": "mario",
      "tags": [
        "salkantay",
        "camino-inca",
        "trekking"
      ],
      "t": "Desafío Inka 7 días: Salkantay y Camino Inka a Machu Picchu",
      "p": "Hice el 7D/6N Salkantay + Inca Trail y ante todo recomendaría esta experiencia a cualquiera que tenga dudas o que esté explorando diferentes rutas o agencias. Esta ruta tiene todo lo necesario en términos de paisajes, desafíos y ecosistemas. […] La comida estaba fuera de este mundo.",
      "n": "Mario E",
      "f": "dic. 2025 · Amigos",
      "src": "Traducida del inglés · Reseña en TripAdvisor"
    }
  ]
};
