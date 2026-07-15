// Shared theme for the RailBack schema docs.
#let accent = rgb("#000000")
#let accent2 = rgb("#000000")
#let softgray = rgb("#f2f2f2")
#let bordergray = rgb("#bbbbbb")
#let monobg = rgb("#f0f0f0")

#let doc(title: "", subtitle: "", body) = {
  set document(title: title)
  set page(
    paper: "a4",
    margin: (x: 2.2cm, y: 2.4cm),
    footer: context [
      #set text(8pt, fill: gray)
      #line(length: 100%, stroke: 0.4pt + bordergray)
      #v(2pt)
      #grid(columns: (1fr, 1fr),
        align(left)[RailBack · DynamoDB Schema],
        align(right)[#counter(page).display("1 / 1", both: true)],
      )
    ],
  )
  set text(font: ("Helvetica Neue", "Arial"), size: 10pt, lang: "de")
  set par(justify: true, leading: 0.62em)
  show heading: set text(fill: accent)
  show heading.where(level: 1): it => block(below: 0.9em, above: 1.2em)[
    #set text(18pt, weight: "bold")
    #it.body
    #v(-6pt)
    #line(length: 100%, stroke: 1pt + accent)
  ]
  show heading.where(level: 2): set text(13pt, weight: "bold")
  show heading.where(level: 3): set text(11pt, weight: "bold", fill: accent2)
  show raw.where(block: false): it => {
    set text(font: "Menlo", size: 8.5pt)
    highlight(fill: monobg, extent: 1pt, it)
  }

  // Title
  text(22pt, weight: "bold")[RailBack]
  if subtitle != "" [
    #v(4pt)
    #text(10.5pt)[Dieses PDF enthält: #subtitle.]
  ]
  v(4pt)
  line(length: 100%, stroke: 1pt + black)
  v(10pt)
  body
}

// Entity field table: rows are (name, type, note)
#let fieldtable(..rows) = {
  table(
    columns: (auto, auto, 1fr),
    inset: (x: 7pt, y: 4pt),
    align: (left, left, left),
    stroke: 0.5pt + bordergray,
    fill: (_, y) => if y == 0 { accent } else { none },
    table.header(
      text(fill: white, weight: "bold")[Attribut],
      text(fill: white, weight: "bold")[Typ],
      text(fill: white, weight: "bold")[Bedeutung / Constraint],
    ),
    ..rows
  )
}

#let keycell(s) = raw(s)
