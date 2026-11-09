(
    <div id="424-0" style={{ borderTopColor: 'var(--line)', borderTopStyle: 'solid', borderTopWidth: '1px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', flexShrink: '0', fontSize: '12px', fontSynthesis: 'none', gap: '14px', lineHeight: '16px', MozOsxFontSmoothing: 'grayscale', overflowWrap: 'anywhere', paddingTop: '24px', WebkitFontSmoothing: 'antialiased', width: '612px' }}>
      <div id="425-0" style={{ boxSizing: 'border-box', color: 'var(--text)', fontFamily: '"Inter-SemiBold", "Inter", system-ui, sans-serif', fontSize: '20px', fontWeight: 600, lineHeight: '28px' }}>
        Review it. Keep your place.
      </div>
      <div id="426-0" style={{ boxSizing: 'border-box', color: '#9FA8B7', fontFamily: '"Inter-Regular", "Inter", system-ui, sans-serif', fontSize: '12px', lineHeight: '18px' }}>
        Candidate implementation · Terminal #1355 · browser qualification pending
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="610" height="260" viewBox="0 0 610 260" aria-label="Reviewing a story moves focus to the next remaining headline; after the last review, focus returns to the selected New filter." id="427-0" style={{ display: 'inline-block', flexShrink: 0 }}>
        <rect x="0.5" y="34.5" width="184" height="192" rx="12" fill="#171B22" stroke="#3A414D" />
        <rect x="212.5" y="34.5" width="184" height="192" rx="12" fill="#171B22" stroke="#3A414D" />
        <rect x="424.5" y="34.5" width="184" height="192" rx="12" fill="#171B22" stroke="#3A414D" />
        <g fontFamily="Inter,Arial,sans-serif" fontSize="11" fontWeight="600" letterSpacing="0.6">
          <text x="0" y="17" fill="#CDD2DC">{"1 · REVIEW A STORY"}</text>
          <text x="212" y="17" fill="#CDD2DC">{"2 · KEEP READING"}</text>
          <text x="424" y="17" fill="#CDD2DC">{"3 · LAST REVIEW"}</text>
        </g>
        <g fontFamily="Inter,Arial,sans-serif" fontSize="12">
          <rect x="14" y="48" width="62" height="26" rx="6" fill="#2B313B" />
          <text x="24" y="65" fill="#E1E5ED">{"New 3"}</text>
          <text x="14" y="96" fill="#A4ACBB">{"Story A"}</text>
          <path d="M14 106H170" fill="#000000" stroke="#303744" />
          <text x="14" y="127" fill="#E1E5ED">{"Story B"}</text>
          <rect x="12" y="138" width="112" height="29" rx="6" fill="#25334F" stroke="#B8CAFF" strokeWidth="2" />
          <text x="23" y="157" fill="#ECF1FF">{"Mark reviewed"}</text>
          <text x="14" y="197" fill="#A4ACBB">{"Story C"}</text>
          <rect x="226" y="48" width="62" height="26" rx="6" fill="#2B313B" />
          <text x="236" y="65" fill="#E1E5ED">{"New 2"}</text>
          <text x="226" y="96" fill="#A4ACBB">{"Story A"}</text>
          <path d="M226 106H382" fill="#000000" stroke="#303744" />
          <rect x="224" y="117" width="160" height="30" rx="5" fill="#25334F" stroke="#B8CAFF" strokeWidth="2" />
          <text x="234" y="137" fill="#ECF1FF">{"Story C headline"}</text>
          <text x="226" y="174" fill="#A4ACBB">{"Tab continues here"}</text>
          <rect x="437" y="47" width="64" height="28" rx="6" fill="#25334F" stroke="#B8CAFF" strokeWidth="2" />
          <text x="448" y="65" fill="#ECF1FF">{"New 0"}</text>
          <text x="438" y="121" fill="#E1E5ED">{"No stories match."}</text>
          <text x="438" y="145" fill="#A4ACBB">{"The filter stays New."}</text>
          <text x="438" y="169" fill="#A4ACBB">{"Choose what is next."}</text>
        </g>
        <path d="M191 126H206m-4-4 4 4-4 4M403 126H418m-4-4 4 4-4 4" fill="none" stroke="#8E98A9" strokeWidth="1.5" />
        <g fontFamily="Inter,Arial,sans-serif" fontSize="11">
          <text x="0" y="250" fill="#A4ACBB">{"Illustrative story IDs · outline indicates keyboard focus · final panel follows the last remaining review"}</text>
        </g>
      </svg>
      <div id="433-0" style={{ boxSizing: 'border-box', color: 'var(--text-2)', fontFamily: '"Inter-Regular", "Inter", system-ui, sans-serif', fontSize: '14px', lineHeight: '22px' }}>
        All: stay on the same headline. New / Updated: use the next surviving story from the prior list, then the nearest prior story. When the list is empty, or Mark shown becomes disabled, focus the selected review filter. Keep both filters unchanged.
      </div>
      <div id="434-0" style={{ boxSizing: 'border-box', color: 'var(--text-2)', fontFamily: '"Inter-Regular", "Inter", system-ui, sans-serif', fontSize: '14px', lineHeight: '22px' }}>
        TickerNewsPanel owns one local focus intent, armed only by the focused review button. Consume it after the DOM commit—even for a no-op. Cancel on account, subject, view, filter or snapshot changes and respect a newer focus choice. Other-tab updates never arm it. No timer or animated scroll.
      </div>
      <div id="435-0" style={{ boxSizing: 'border-box', color: 'var(--text-2)', fontFamily: '"Inter-Regular", "Inter", system-ui, sans-serif', fontSize: '14px', lineHeight: '22px' }}>
        NewsCatchup exposes the initiating button. useNewsCatchup keeps review and storage authority. An unlinked headline is a programmatic focus target with tabindex −1; it stays plain text and adds no tab stop. Use the existing visible focus outline.
      </div>
      <div id="436-0" style={{ boxSizing: 'border-box', color: 'var(--text-2)', fontFamily: '"Inter-Regular", "Inter", system-ui, sans-serif', fontSize: '13px', lineHeight: '21px' }}>
        Local proof: 29/29 component cases pass; unchanged source fails seven focus cases. Focused typecheck passes. Existing browser tests now cover Enter, Tab, empty filters and disabled bulk review at the contract viewports. Their execution, release and live proof remain owed.
      </div>
      <div id="437-0" style={{ boxSizing: 'border-box', color: '#9FA8B7', fontFamily: '"Inter-Regular", "Inter", system-ui, sans-serif', fontSize: '11px', lineHeight: '18px' }}>
        Source: mastermind-terminal · PR #1355 · head 187abb3124edbf29f3bb23a8d81c40b46315ff59. Builder details: docs/NEWS_REVIEW_FOCUS_2026-11-09.md. Paper is the interaction reference; this specimen does not establish browser or production acceptance.
      </div>
    </div>
  )