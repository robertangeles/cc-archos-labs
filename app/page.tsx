export default function Home() {
  return (
    <main className="flex flex-1 flex-col justify-center px-6 py-24 max-w-2xl mx-auto">
      <h1 className="font-serif text-5xl md:text-6xl leading-tight tracking-tight text-ink">
        We solve the problem
        <br />
        that AI programs ignore.
      </h1>
      <p className="mt-8 text-lg leading-relaxed text-muted">
        Most AI transformations fail not because of the models. They fail
        because the data underneath them was never ready — ungoverned,
        unmodelled, and unfit for the decisions being made on top of it.
      </p>
      <p className="mt-6 text-lg leading-relaxed text-muted">
        Archos Labs sits in the gap.{" "}
        <a
          href="#"
          className="text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent transition-colors"
        >
          Engage Consulting
        </a>
        .
      </p>
    </main>
  );
}
