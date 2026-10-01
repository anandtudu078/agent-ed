/**
 * The starter catalog.
 *
 * Lives outside the route file: this is content, not request handling, and it
 * grows every time the curriculum does.
 *
 * `category` is the index that makes the branches of a subject legible — the
 * AI material is deliberately split across "AI Foundations", "Machine
 * Learning", "Deep Learning", "Generative AI", and so on, rather than dumped
 * into one bucket where a student can't see the shape of the field.
 *
 * Each module's `topic` is the join key to a student's `topicsVisited`, so it
 * should read like something a tutor would say out loud ("backpropagation"),
 * never a slug ("module-3").
 */

export interface CurriculumModule {
  title: string;
  topic: string;
  /**
   * What this module actually covers, broken out.
   *
   * Shown on the course detail screen so a student can see the shape of a
   * module before committing to it, rather than discovering what a lesson
   * covers only once they are halfway through it. Purely descriptive — the
   * tutor is not given these, and progress is still counted per module, not
   * per subtopic, so adding or removing one never moves a student's percentage.
   *
   * Optional, and the UI renders a module without them perfectly well. That is
   * deliberate: an uncurated subtopic list is a worse thing to show than no
   * subtopic list, so a module we haven't written one for shows its title alone
   * instead of a padded or invented one.
   */
  subtopics?: string[];
  /**
   * Topics that must be understood first.
   *
   * Referenced by free text and matched fuzzily, the same way `topicsVisited`
   * is — these strings come from a model reading chat, so they will never line
   * up character-for-character with a hand-written syllabus.
   *
   * Only curated where a real dependency exists. A module with no entry here
   * has no known prerequisites and behaves exactly as it did before, which is
   * why this is a sparse graph rather than a fully specified one: a wrong edge
   * sends a student backwards for no reason, and an uncurated edge is cheaper
   * than a wrong one.
   */
  prerequisites?: string[];
}

export interface CurriculumCourse {
  title: string;
  category: string;
  description: string;
  level: "beginner" | "intermediate" | "advanced";
  modules: CurriculumModule[];
}

const CURRICULUM: CurriculumCourse[] = [
  {
    title: "Introduction to Programming",
    category: "Programming",
    description: "Variables, loops, functions, and how code actually runs.",
    level: "beginner",
    modules: [
      { title: "Variables and types", topic: "variables and data types", subtopics: ["Naming and reassignment", "Numbers, text and booleans", "Type errors and why they happen"] },
      { title: "Conditionals", topic: "if statements and conditionals", subtopics: ["if / else / else if", "Comparison operators", "Combining conditions with and / or"] },
      { title: "Loops", topic: "loops and iteration", subtopics: ["for loops and counting", "while loops", "Breaking out and avoiding infinite loops"] },
      { title: "Functions", topic: "functions and parameters", subtopics: ["Defining and calling a function", "Parameters and return values", "Scope: what a function can see"] },
      { title: "Debugging", topic: "debugging and reading errors", subtopics: ["Reading an error message bottom-up", "Common beginner mistakes", "Print debugging and narrowing it down"] },
    ],
  },
  {
    title: "Web Development Basics",
    category: "Web Development",
    description: "HTML, CSS, and JavaScript — build your first web page.",
    level: "beginner",
    modules: [
      { title: "HTML structure", topic: "html structure and elements", subtopics: ["Elements, tags and nesting", "Attributes like id and class", "Semantic tags: header, nav, main"] },
      { title: "CSS styling", topic: "css styling and layout", subtopics: ["Selectors and specificity", "The box model", "Flexbox and Grid for layout"] },
      { title: "Responsive design", topic: "responsive web design", subtopics: ["Mobile-first thinking", "Media queries", "Relative units and fluid layouts"] },
      { title: "DOM manipulation", topic: "dom manipulation", subtopics: ["Selecting elements with JavaScript", "Creating and removing nodes", "Updating text and attributes"] },
      { title: "Events", topic: "javascript events and handlers", subtopics: ["Adding event listeners", "Event objects and bubbling", "Preventing default behaviour"] },
    ],
  },
  {
    title: "Data Structures Fundamentals",
    category: "Computer Science",
    description: "Arrays, lists, stacks, queues, and when to reach for each.",
    level: "intermediate",
    modules: [
      { title: "Arrays", topic: "arrays and indexing", subtopics: ["Creating and indexing", "Length and out-of-bounds", "Common array operations"] },
      { title: "Linked lists", topic: "linked lists", subtopics: ["Nodes and pointers", "Insert and remove compared to arrays", "When a linked list is the wrong choice"] },
      { title: "Stacks and queues", topic: "stacks and queues", subtopics: ["LIFO and FIFO", "Push, pop and enqueue", "Real uses: undo, call stacks, queues"] },
      { title: "Hash tables", topic: "hash tables and dictionaries", subtopics: ["Keys, values and hashing", "Collisions and why they are fine", "Lookup speed versus arrays"] },
      { title: "Trees", topic: "trees and binary search trees", subtopics: ["Nodes, roots and children", "Traversals: in, pre, post", "Balancing and why height matters"] },
    ],
  },
  {
    title: "Algorithms Step by Step",
    category: "Computer Science",
    description: "Sorting, searching, and thinking about efficiency.",
    level: "intermediate",
    modules: [
      { title: "Big O notation", topic: "big o notation and time complexity", subtopics: ["What the O actually measures", "Common classes: constant to exponential", "Reading complexity off a piece of code"] },
      { title: "Searching", topic: "searching algorithms", subtopics: ["Linear search", "Binary search and the sorted-array requirement", "When to search versus index"] },
      { title: "Sorting", topic: "sorting algorithms", subtopics: ["Bubble and insertion sort", "Merge sort and quicksort", "Stability and choosing in practice"] },
      { title: "Recursion", topic: "recursion", subtopics: ["Base case and recursive case", "Call stack and what it costs", "Recursion versus iteration"] },
      { title: "Greedy and dynamic programming", topic: "dynamic programming", subtopics: ["Greedy choices and where they fail", "Memoisation and tabulation", "Overlapping subproblems"] },
    ],
  },
  {
    title: "Databases & MongoDB",
    category: "Databases",
    description: "How data is stored, queried, and modelled in documents.",
    level: "intermediate",
    modules: [
      { title: "Data modelling", topic: "data modelling and schemas", subtopics: ["Documents, collections and fields", "Choosing what to embed versus reference", "Schema design and validation"] },
      { title: "CRUD operations", topic: "crud operations", subtopics: ["Create, read, update, delete", "Filters and projections", "Updating nested fields safely"] },
      { title: "Indexing", topic: "database indexing", subtopics: ["What an index actually does", "Which fields to index", "The write cost of an index"] },
      { title: "Aggregation", topic: "aggregation pipelines", subtopics: ["Stages and running in order", "match, group and project", "Lookup and unwind"] },
      { title: "Transactions", topic: "database transactions", subtopics: ["Why writes need to be all-or-nothing", "Sessions and commit / abort", "What you lose without them"] },
    ],
  },

  // ── AI: the classical branches ────────────────────────────────────────
  {
    title: "Maths for AI",
    category: "AI Foundations",
    description:
      "The small amount of maths that AI actually rests on, taught from scratch.",
    level: "beginner",
    modules: [
      { title: "Vectors and vector spaces", topic: "vectors and vector spaces", subtopics: ["Components, magnitude and direction", "Vector addition and scaling", "What a vector space is"] },
      { title: "Matrix shapes and operations", topic: "matrix multiplication for attention", subtopics: ["Rows, columns and shape", "Matrix multiplication and why order matters", "Transpose and reshaping"] , prerequisites: ["vectors and vector spaces"] },
      { title: "Dot products", topic: "dot products and matrix multiplication", subtopics: ["Computing a dot product", "Dot product as projection and similarity", "Batched matrix products" ], prerequisites: ["matrix multiplication for attention"] },
      { title: "Linear algebra for ML", topic: "linear algebra for machine learning", subtopics: ["Eigenvalues and eigenvectors", "Rank and what it means for data", "Decompositions used in models"] , prerequisites: ["matrix multiplication for attention"] },
      { title: "Limits and continuity", topic: "limits and continuity", subtopics: ["Limits as approach, not arrival", "Continuity and discontinuities", "Why this matters for gradients"] , prerequisites: ["functions and parameters"] },
      { title: "Derivatives", topic: "calculus and derivatives", subtopics: ["Rate of change", "Product, quotient and chain rules", "Partial derivatives"] , prerequisites: ["limits and continuity"] },
      { title: "Chain rule", topic: "chain rule and partial derivatives", subtopics: ["Composing functions", "Why backpropagation is the chain rule", "Gradients flowing backwards" ] , prerequisites: ["calculus and derivatives", "functions and parameters"] },
      { title: "Probability basics", topic: "probability basics for machine learning", subtopics: ["Sample space and events", "Conditional probability and Bayes' theorem", "Expectation and variance"] },
    ],
  },
  {
    title: "What Is Artificial Intelligence?",
    category: "AI Foundations",
    description:
      "Where AI came from, what counts as intelligence, and how the field splits.",
    level: "beginner",
    modules: [
      { title: "A short history of AI", topic: "history of artificial intelligence", subtopics: ["Early rule-based attempts", "The AI winters and why", "The deep learning revival"] },
      { title: "What makes a system intelligent", topic: "defining artificial intelligence", subtopics: ["Definitions and why they disagree", "Intelligence as a test, not a trait", "Capability versus understanding"] },
      { title: "Narrow vs general AI", topic: "narrow ai versus general ai", subtopics: ["What narrow AI actually is", "What AGI would require", "Where today's systems sit"] },
      { title: "The Turing test", topic: "turing test and machine intelligence", subtopics: ["The original proposal", "Why it is hard to game or satisfy", "What it does and does not prove"] },
      { title: "Symbolic vs connectionist AI", topic: "symbolic versus connectionist ai", subtopics: ["Rules and logic", "Learned representations", "Why modern systems mix both"] },
      { title: "Where AI is used today", topic: "real world applications of ai", subtopics: ["Everyday systems you already use", "Where it quietly fails", "Choosing not to use it"] },
    ],
  },
  {
    title: "Search & Problem Solving",
    category: "AI Foundations",
    description:
      "How a machine searches a space of possibilities and finds a good answer.",
    level: "intermediate",
    modules: [
      { title: "State space search", topic: "state space search", subtopics: ["States, actions and transitions", "Building the search graph", "Start, goal and path cost"] },
      { title: "Breadth-first search", topic: "breadth first search", subtopics: ["The frontier queue", "Completeness and optimality", "Memory cost and when it bites"] },
      { title: "Depth-first search", topic: "depth first search", subtopics: ["Going deep before wide", "When DFS beats BFS", "Cycles and visited sets"] },
      { title: "Heuristic search", topic: "heuristic search and heuristics", subtopics: ["Estimating distance to the goal", "Admissible versus non-admissible", "Where heuristics come from"] },
      { title: "A* algorithm", topic: "a star algorithm", subtopics: ["Combining cost-so-far and estimate", "Why f = g + h works", "Tie-breaking and weighted A*"] },
      { title: "Constraint satisfaction", topic: "constraint satisfaction problems", subtopics: ["Variables, domains and constraints", "Backtracking search", "Forward checking and propagation"] },
      { title: "Minimax and game trees", topic: "minimax and game tree search", subtopics: ["Adversarial search", "Pruning with alpha-beta", "Why perfect play is expensive"] },
    ],
  },
  {
    title: "Logic & Knowledge Representation",
    category: "AI Foundations",
    description:
      "How facts, rules and relationships get represented so a machine can reason.",
    level: "intermediate",
    modules: [
      { title: "Propositional logic", topic: "propositional logic", subtopics: ["Atoms and connectives", "Truth tables", "Valid inference"] },
      { title: "First-order logic", topic: "first order logic and predicates", subtopics: ["Predicates and quantifiers", "Modelling objects and relations", "Unification"] },
      { title: "Forward and backward chaining", topic: "forward and backward chaining", subtopics: ["Forward from known facts", "Backward from a goal", "Choosing a direction"] },
      { title: "Rule engines", topic: "rule based systems", subtopics: ["IF-THEN rules in practice", "Conflict resolution", "Where rule engines are still used"] },
      { title: "Ontologies", topic: "ontologies and semantic description", subtopics: ["Entities, classes and relations", "Describing meaning formally", "Shared vocabularies"] },
      { title: "Knowledge graphs", topic: "knowledge graphs", subtopics: ["Nodes, edges and triples", "Querying a graph", "Building one from messy text"] },
    ],
  },
  {
    title: "Expert Systems",
    category: "AI Foundations",
    description:
      "The classic rule-based approach to AI, and where it still beats modern models.",
    level: "intermediate",
    modules: [
      { title: "How an expert system works", topic: "how expert systems work", subtopics: ["Knowledge base plus inference", "The rule / fact split", "Why the reasoning is inspectable"] },
      { title: "Inference engines", topic: "inference engines", subtopics: ["Driving the rules", "Chaining and termination", "Explaining a conclusion"] },
      { title: "MYCIN and medical diagnosis", topic: "mycin expert system", subtopics: ["The rules it used", "How it beat doctors in trials", "Why it was never deployed"] },
      { title: "Handling uncertainty", topic: "uncertainty in expert systems", subtopics: ["Confidence factors", "Combining uncertain evidence", "Where naive rules go wrong"] },
      {
        title: "When rules beat machine learning",
        topic: "expert systems versus machine learning",
        subtopics: ["Auditability and regulation", "When you can write the rules down", "Hybrid systems"],
      },
    ],
  },

  // ── AI: machine learning branches ─────────────────────────────────────
  {
    title: "Machine Learning Concepts",
    category: "Machine Learning",
    description: "What models are, how they learn, and where AI shows up daily.",
    level: "beginner",
    modules: [
      { title: "What is a model", topic: "machine learning models", subtopics: ["A function fitted to data", "Parameters versus hyperparameters", "What training actually optimises"], prerequisites: ["variables and data types", "functions and parameters"] },
      { title: "Features and labels", topic: "features and labels in machine learning", subtopics: ["Choosing inputs", "Labelling data well or badly", "Feature leakage"], prerequisites: ["variables and data types"] },
      { title: "Training data", topic: "training data", subtopics: ["Collecting and cleaning", "Class imbalance", "How much data is enough"], prerequisites: ["features and labels in machine learning"] },
      { title: "Overfitting and underfitting", topic: "overfitting and underfitting", subtopics: ["Memorising versus generalising", "The bias-variance trade-off", "Spotting each from a curve"], prerequisites: ["train validation and test split"] },
      { title: "Train, validation and test splits", topic: "train validation and test split", subtopics: ["Why three sets and not two", "Choosing proportions", "Never touching the test set"], prerequisites: ["training data"] },
      { title: "Evaluation metrics", topic: "model evaluation and metrics", subtopics: ["Accuracy and its trap", "Precision, recall and F1", "Choosing a metric that matches the cost"], prerequisites: ["classification problems"] },
      { title: "Everyday AI", topic: "everyday applications of ai", subtopics: ["Recommendation and ranking", "Spam, fraud and moderation", "What runs on your phone"] },
    ],
  },
  {
    title: "Supervised Learning",
    category: "Machine Learning",
    description: "Learning from labelled examples: predicting numbers and labels.",
    level: "intermediate",
    modules: [
      { title: "Regression", topic: "linear and polynomial regression", subtopics: ["Fitting a line", "Loss and least squares", "Polynomial features and overfitting"], prerequisites: ["linear algebra for machine learning", "functions and parameters"] },
      { title: "Classification", topic: "classification problems", subtopics: ["Predicting a label", "Decision boundaries", "Multi-class and multi-label"], prerequisites: ["linear and polynomial regression"] },
      { title: "k-nearest neighbours", topic: "k nearest neighbours algorithm", subtopics: ["Distance and the k choice", "Curse of dimensionality", "Why it needs scaled features"], prerequisites: ["classification problems"] },
      { title: "Decision trees", topic: "decision trees", subtopics: ["Splitting on a feature", "Gini impurity and entropy", "Pruning to avoid overfitting"], prerequisites: ["classification problems"] },
      { title: "Support vector machines", topic: "support vector machines", subtopics: ["Maximum margin", "Kernels for non-linear data", "Cost parameter and trade-offs"], prerequisites: ["linear algebra for machine learning", "classification problems"] },
      { title: "Ensembles and bagging", topic: "ensembles and bagging", subtopics: ["Why averaging reduces variance", "Bootstrap sampling", "Random forests"], prerequisites: ["decision trees"] },
      { title: "Gradient boosting", topic: "gradient boosting", subtopics: ["Boosting residuals", "Learning rate and depth", "XGBoost and LightGBM"], prerequisites: ["ensembles and bagging"] },
    ],
  },
  {
    title: "Unsupervised Learning",
    category: "Machine Learning",
    description: "Finding structure in data that arrives without any labels.",
    level: "intermediate",
    modules: [
      { title: "Clustering", topic: "clustering", subtopics: ["Groups with no labels", "Distance and similarity", "What makes a cluster good"], prerequisites: ["linear and polynomial regression"] },
      { title: "k-means", topic: "k means clustering", subtopics: ["Centroids and assignment", "The k-means algorithm", "Choosing k and its failure modes"], prerequisites: ["clustering", "linear algebra for machine learning"] },
      { title: "Hierarchical clustering", topic: "hierarchical clustering", subtopics: ["Building a dendrogram", "Linkage methods", "Cutting the tree into clusters"], prerequisites: ["clustering"] },
      { title: "Dimensionality reduction", topic: "dimensionality reduction", subtopics: ["Why fewer dimensions help", "Feature selection versus extraction", "The curse of dimensionality"], prerequisites: ["linear algebra for machine learning"] },
      { title: "Principal component analysis", topic: "principal component analysis", subtopics: ["Finding the axes of greatest variance", "Eigenvectors as new axes", "Interpreting the components"], prerequisites: ["dimensionality reduction", "linear algebra for machine learning"] },
      { title: "Association rules", topic: "association rules and market basket analysis", subtopics: ["Support and confidence", "Market basket analysis", "The false-discovery trap"], prerequisites: ["clustering"] },
      { title: "Anomaly detection", topic: "anomaly detection", subtopics: ["What counts as unusual", "Methods with and without labels", "The false-alarm problem"], prerequisites: ["classification problems", "clustering"] },
    ],
  },
  {
    title: "Reinforcement Learning",
    category: "Machine Learning",
    description: "Learning by trial, error and reward — how machines learn to act.",
    level: "advanced",
    modules: [
      {
        title: "The agent-environment loop",
        topic: "agents and environments in reinforcement learning",
        subtopics: ["Agents, actions and observations", "The interaction loop", "Designing a reward"],
        prerequisites: ["functions and parameters", "if statements and conditionals"],
      },
      { title: "Markov decision processes", topic: "markov decision process", subtopics: ["States, actions and transition probabilities", "The Markov property", "Formally specifying an MDP"], prerequisites: ["agents and environments in reinforcement learning"] },
      { title: "Rewards and returns", topic: "rewards and discounted returns", subtopics: ["Immediate versus delayed reward", "Discounting and why", "Designing rewards that resist gaming"], prerequisites: ["markov decision process"] },
      { title: "Q-learning", topic: "q learning algorithm", subtopics: ["The Q-function as a value estimate", "The update rule", "Off-policy learning and epsilon-greedy"], prerequisites: ["markov decision process", "rewards and discounted returns"] },
      { title: "Exploration vs exploitation", topic: "exploration versus exploitation", subtopics: ["The greedy trap", "Epsilon-greedy and UCB", "Curiosity and intrinsic reward"], prerequisites: ["q learning algorithm"] },
      { title: "Policy gradients", topic: "policy gradient methods", subtopics: ["Learning a policy directly", "The policy gradient idea in plain terms", "Actor-critic and PPO"], prerequisites: ["q learning algorithm", "gradient descent"] },
      { title: "Applications of RL", topic: "applications of reinforcement learning", subtopics: ["Robotics and control", "Games and simulation", "Why real-world RL is still rare"], prerequisites: ["policy gradient methods"] },
    ],
  },

  // ── AI: deep learning ─────────────────────────────────────────────────
  {
    title: "Neural Networks Explained",
    category: "Deep Learning",
    description:
      "How a network learns: neurons, layers, weights, and why training actually works.",
    level: "advanced",
    modules: [
      { title: "The perceptron", topic: "perceptrons and artificial neurons", subtopics: ["A weighted sum and a threshold", "Why one neuron cannot learn XOR", "From biological neurons to artificial ones"], prerequisites: ["linear and polynomial regression"] },
      { title: "Layers and activation", topic: "layers and activation functions", subtopics: ["Sigmoid, ReLU and tanh", "Why nonlinearity is essential", "Choosing an activation"], prerequisites: ["perceptrons and artificial neurons"] },
      { title: "Weights and bias", topic: "weights and bias in neural networks", subtopics: ["What each weight encodes", "Why bias shifts the boundary", "Initialising weights"], prerequisites: ["layers and activation functions"] },
      { title: "Forward pass", topic: "forward pass in a neural network", subtopics: ["Input to output, layer by layer", "Matrix form of the computation", "Where activations are stored"], prerequisites: ["weights and bias in neural networks", "matrix multiplication for attention"] },
      { title: "Backpropagation", topic: "backpropagation", subtopics: ["Computing gradients layer by layer", "The chain rule applied recursively", "Storing activations for the backward pass"], prerequisites: ["forward pass in a neural network", "chain rule and partial derivatives", "linear algebra for machine learning"] },
      { title: "Gradient descent", topic: "gradient descent", subtopics: ["Following the slope downhill", "Learning rate and divergence", "Batch, stochastic and mini-batch"], prerequisites: ["backpropagation", "calculus and derivatives"] },
      { title: "Training a network", topic: "training a neural network from scratch", subtopics: ["Putting the loop together", "Choosing epochs and stopping", "Reading the loss curve"], prerequisites: ["gradient descent", "training data"] },
    ],
  },
  {
    title: "Deep Learning Architectures",
    category: "Deep Learning",
    description:
      "The specific network shapes that made vision, speech and generation work.",
    level: "advanced",
    modules: [
      { title: "Convolutional networks", topic: "convolutional neural networks", subtopics: ["Why images need a different architecture", "Filters and feature maps", "Parameter sharing"], prerequisites: ["forward pass in a neural network"] },
      { title: "Pooling and feature maps", topic: "pooling and feature maps", subtopics: ["Max and average pooling", "Building up hierarchy of features", "Flattening before the dense layers"], prerequisites: ["convolutional neural networks"] },
      { title: "Recurrent networks", topic: "recurrent neural networks", subtopics: ["State carried across time", "The vanishing gradient problem", "Where sequence models beat feedforward"], prerequisites: ["forward pass in a neural network"] },
      { title: "LSTM and gated memory", topic: "lstm and gated recurrent units", subtopics: ["Gates and what they forget", "LSTM versus GRU", "Why transformers replaced them"], prerequisites: ["recurrent neural networks"] },
      { title: "Autoencoders", topic: "autoencoders", subtopics: ["Encode to a bottleneck and decode", "Learning useful features", "Denoising and sparse autoencoders"], prerequisites: ["forward pass in a neural network"] },
      { title: "Residual connections", topic: "residual connections and skip layers", subtopics: ["Adding the input back", "Why they made deep nets trainable", "ResNet and beyond"], prerequisites: ["layers and activation functions"] },
      { title: "Generative adversarial networks", topic: "generative adversarial networks", subtopics: ["Generator versus discriminator", "The adversarial training loop", "Mode collapse and why it happens"], prerequisites: ["autoencoders", "training a neural network from scratch"] },
    ],
  },
  {
    title: "Training & Optimization",
    category: "Deep Learning",
    description: "The craft of getting a network to actually converge and generalise.",
    level: "advanced",
    modules: [
      { title: "Loss functions", topic: "loss functions in machine learning", subtopics: ["Mean squared error", "Cross-entropy and why it suits classification", "Choosing a loss to match the task"] },
      { title: "Optimizers", topic: "optimizers like sgd and adam", subtopics: ["SGD and its variants", "Momentum", "Adam and adaptive methods"] },
      { title: "Regularization", topic: "regularization and early stopping", subtopics: ["L1 and L2 penalties", "Early stopping", "Data augmentation"] },
      { title: "Dropout and batch normalization", topic: "dropout and batch normalization", subtopics: ["Dropout as noise injection", "Normalising activations", "Inference-time differences"] },
      { title: "Hyperparameter tuning", topic: "hyperparameter tuning", subtopics: ["Grid and random search", "Bayesian optimisation", "Avoiding the validation trap"] },
      { title: "Transfer learning", topic: "transfer learning and pretrained models", subtopics: ["Reusing learned features", "Fine-tuning versus feature extraction", "When a small dataset is enough"] },
      { title: "Reading a training curve", topic: "diagnosing model training curves", subtopics: ["High bias versus high variance", "Divergence and unstable training", "What each shape is telling you"] },
    ],
  },

  // ── AI: generative ────────────────────────────────────────────────────
  {
    title: "Transformers & Large Language Models",
    category: "Generative AI",
    description:
      "Attention, tokens, and how models like this one actually generate text.",
    level: "advanced",
    modules: [
      { title: "Tokens and vocabulary", topic: "tokens and tokenization", subtopics: ["Subwords and why not whole words", "The vocabulary and unknown tokens", "Token counts drive cost and context length"], prerequisites: ["text preprocessing and cleaning"] },
      { title: "The attention mechanism", topic: "self attention mechanism", subtopics: ["What attention solves about recurrence", "Computing attention weights", "Why it replaced recurrence"], prerequisites: ["matrix multiplication for attention", "forward pass in a neural network"] },
      { title: "Query, key and value", topic: "query key and value in attention", subtopics: ["Asking, matching and retrieving", "Scaled dot-product attention", "Reading an attention matrix"], prerequisites: ["self attention mechanism"] },
      { title: "Multi-head attention", topic: "multi head attention", subtopics: ["Several attention runs in parallel", "Different heads learning different relations", "Concatenating the heads"], prerequisites: ["query key and value in attention"] },
      { title: "Positional encoding", topic: "positional encoding in transformers", subtopics: ["Attention has no sense of order", "Sinusoidal and learned positions", "Relative versus absolute position"], prerequisites: ["tokens and tokenization"] },
      { title: "Pretraining and fine-tuning", topic: "pretraining and fine tuning", subtopics: ["Next-token prediction at scale", "Adapting to a specific task", "Full fine-tuning versus adapters"], prerequisites: ["multi head attention"] },
      { title: "Autoregressive generation", topic: "autoregressive text generation", subtopics: ["One token at a time", "Sampling: greedy, temperature, top-p", "Why generation is slow"], prerequisites: ["pretraining and fine tuning"] },
      { title: "Context windows", topic: "context window and token limits", subtopics: ["What fits in the window", "Attention cost versus length", "Truncation and summarisation"], prerequisites: ["autoregressive text generation"] },
      { title: "Hallucination", topic: "llm hallucination and why it happens", subtopics: ["Fluent and confidently wrong", "Why next-token prediction invites it", "Grounding and verification"], prerequisites: ["autoregressive text generation"] },
    ],
  },
  {
    title: "Generative Models",
    category: "Generative AI",
    description: "How machines make new things — images, text, audio and video.",
    level: "advanced",
    modules: [
      { title: "What is generative AI", topic: "generative ai", subtopics: ["Learning a distribution, not a label", "Sampling from what was learned", "What it cannot do"], prerequisites: ["machine learning models"] },
      { title: "Variational autoencoders", topic: "variational autoencoders", subtopics: ["Latent space and the reparameterisation trick", "KL divergence and ELBO", "Sampling from a latent space"] , prerequisites: ["autoencoders"] },
      { title: "Adversarial training", topic: "adversarial training in gans", subtopics: ["The two-player minimax game", "Training instability and tricks", "StyleGAN and beyond"] , prerequisites: ["generative adversarial networks"] },
      { title: "Diffusion models", topic: "diffusion models", subtopics: ["Adding noise step by step", "Learning to reverse it", "Why diffusion replaced GANs for images"] , prerequisites: ["forward pass in a neural network"] },
      { title: "Denoising in diffusion", topic: "denoising steps in diffusion models", subtopics: ["The reverse process", "Guidance and classifier-free guidance", "Sampling steps and quality trade-off"] , prerequisites: ["diffusion models"] },
      { title: "Text-to-image models", topic: "text to image generation", subtopics: ["Encoding the prompt into the latent space", "Latent diffusion and Stable Diffusion", "Why hands and text still go wrong"] , prerequisites: ["denoising steps in diffusion models", "tokens and tokenization"] },
      { title: "Video generation", topic: "ai video generation", subtopics: ["Adding a time dimension", "Spatio-temporal attention", "Consistency across frames"] , prerequisites: ["text to image generation", "convolutional neural networks"] },
    ],
  },
  {
    title: "Prompting & Retrieval",
    category: "Generative AI",
    description: "Getting better answers from a model, and giving it your own data.",
    level: "intermediate",
    modules: [
      { title: "Anatomy of a prompt", topic: "prompt engineering basics", subtopics: ["Role, task and context", "Specificity versus vagueness", "Why models comply with phrasing"], prerequisites: ["tokens and tokenization"] },
      { title: "Zero-shot vs few-shot", topic: "zero shot and few shot prompting", subtopics: ["Asking with no examples", "Providing examples and what they buy", "Choosing between them"], prerequisites: ["prompt engineering basics"] },
      { title: "Chain of thought", topic: "chain of thought prompting", subtopics: ["Making reasoning explicit", "When it helps and when it does not", "Self-consistency across samples"], prerequisites: ["prompt engineering basics"] },
      { title: "Embeddings", topic: "vector embeddings and similarity", subtopics: ["Text as vectors", "Cosine similarity", "What good embeddings capture"], prerequisites: ["linear algebra for machine learning"] },
      { title: "Retrieval augmented generation", topic: "retrieval augmented generation rag", subtopics: ["Retrieve, then generate", "Chunking and why it matters", "Grounding answers in your own data"], prerequisites: ["vector embeddings and similarity", "tokens and tokenization"] },
      { title: "Vector databases", topic: "vector databases and indexing", subtopics: ["Nearest-neighbour search at scale", "Approximate nearest neighbours", "Metadata filtering"], prerequisites: ["vector embeddings and similarity"] },
      { title: "Building an AI assistant", topic: "building an ai assistant", subtopics: ["Putting retrieval and generation together", "Conversation memory", "Citing sources and refusing to guess"], prerequisites: ["retrieval augmented generation rag"] },
    ],
  },

  // ── AI: language and perception ───────────────────────────────────────
  {
    title: "Natural Language Processing",
    category: "Natural Language",
    description: "How machines read, understand and generate human language.",
    level: "intermediate",
    modules: [
      { title: "Text preprocessing", topic: "text preprocessing and cleaning", subtopics: ["Lowercasing, stripping and normalising", "Tokenising and removing stopwords", "Stemming and lemmatisation"] },
      { title: "Bag of words and TF-IDF", topic: "bag of words and tf idf", subtopics: ["Representing text as counts", "Why raw counts mislead", "TF-IDF and rare-word weighting"] },
      { title: "Named entity recognition", topic: "named entity recognition", subtopics: ["Finding people, places, organisations", "Sequence labelling with BIO tags", "Why it is hard for ambiguous text"] },
      { title: "Sentiment analysis", topic: "sentiment analysis", subtopics: ["Polarity and beyond", "Lexicon versus model approaches", "Sarcasm and why it defeats sentiment"] },
      { title: "Text classification", topic: "text classification", subtopics: ["Spam, topic and intent classification", "Pipelines and feature engineering", "Evaluating on text"] },
      { title: "Language models for text", topic: "language models for text", subtopics: ["n-grams and statistical LMs", "Word embeddings", "Transformer language models"] },
      { title: "Machine translation", topic: "machine translation", subtopics: ["Sequence-to-sequence models", "Encoder-decoder and attention", "Evaluation beyond word overlap"] },
      { title: "Question answering", topic: "question answering systems", subtopics: ["Extractive versus abstractive", "Attention over passages", "Where QA systems still fail"] },
      { title: "Multilingual models", topic: "multilingual nlp models", subtopics: ["Shared vocabulary across languages", "Transfer between languages", "Low-resource languages"] },
    ],
  },
  {
    title: "Computer Vision",
    category: "Computer Vision",
    description: "Teaching machines to see: from pixels to decisions.",
    level: "advanced",
    modules: [
      { title: "Images as arrays of pixels", topic: "images as pixel arrays", subtopics: ["Pixels, channels and colour spaces", "Resolution and what it costs", "Loading and normalising images"] },
      { title: "Image classification", topic: "image classification", subtopics: ["From pixels to a label", "Transfer learning on small datasets", "Where classification is the wrong tool"] },
      { title: "Convolutional filters", topic: "convolutional filters on images", subtopics: ["Edges and what a filter detects", "Kernels and stride", "Building feature hierarchies"] },
      { title: "Object detection", topic: "object detection", subtopics: ["Localisation as well as classification", "Bounding boxes and IoU", "Anchor-free versus anchor-based"] },
      { title: "Image segmentation", topic: "image segmentation", subtopics: ["Pixel-level labels", "Semantic versus instance segmentation", "U-Net and skip connections"] },
      { title: "Image generation", topic: "ai image generation", subtopics: ["Editing with masks and inpainting", "Controlling composition", "Provenance and deepfake risk"] },
      { title: "Vision transformers", topic: "vision transformers", subtopics: ["Splitting an image into patches", "Attention over patches", "When ViT beats ResNet"] },
      { title: "Multimodal models", topic: "multimodal models and clip", subtopics: ["Joint image-text embeddings", "Zero-shot classification with CLIP", "Aligning modalities"] },
    ],
  },
  {
    title: "Speech & Audio AI",
    category: "Speech & Audio",
    description: "How machines hear speech, recognise voices and make sound.",
    level: "advanced",
    modules: [
      { title: "How sound becomes data", topic: "audio spectrograms and features", subtopics: ["Sampling rate and waveform", "Spectrograms and frequency", "MFCCs and why they work"] },
      { title: "Speech recognition", topic: "automatic speech recognition", subtopics: ["Turning audio into text", "Acoustic models and language models", "Noisy audio and accents"] },
      { title: "Text to speech", topic: "text to speech synthesis", subtopics: ["Concatenating recorded speech", "Neural vocoders", "Naturalness versus controllability"] },
      { title: "Speaker recognition", topic: "speaker recognition and verification", subtopics: ["Identifying who is speaking", "Verification versus identification", "Spoofing and its defences"] },
      { title: "Voice assistants", topic: "building voice assistants", subtopics: ["Wake word, intent and response", "Handling interruption and turn-taking", "What happens with no network"] },
      { title: "Music generation", topic: "ai music generation", subtopics: ["Representing audio as tokens", "Structure, harmony and repetition", "Where generated music still fails"] },
    ],
  },
  {
    title: "Robotics & Autonomous Systems",
    category: "Robotics",
    description: "AI that moves: perceiving the world and acting inside it.",
    level: "advanced",
    modules: [
      { title: "Sensors and perception", topic: "robot sensors and perception", subtopics: ["Cameras, lidar and encoders", "Turning readings into a world model", "Sensor noise and limits"] },
      { title: "Robotics kinematics", topic: "robot kinematics", subtopics: ["Frames and coordinates", "Forward and inverse kinematics", "Degrees of freedom and reach"] },
      { title: "Motion planning", topic: "robot motion planning", subtopics: ["Planning a path through space", "Collision avoidance", "Sampling-based planners"] },
      { title: "Control systems", topic: "robot control systems", subtopics: ["Feedback and closed loops", "PID control", "Stability and overshoot"] },
      { title: "Simultaneous localisation and mapping", topic: "slam simultaneous localisation and mapping", subtopics: ["Where am I and what is around me", "Building a map and tracking position together", "Loop closure"] },
      { title: "Computer vision for robotics", topic: "computer vision in robotics", subtopics: ["Perception in a moving camera", "Depth from stereo and structure", "Real-time constraints"] },
      { title: "Self-driving vehicles", topic: "autonomous vehicles and self driving", subtopics: ["Perception, prediction and planning", "The long tail of rare situations", "Why level 4 is harder than it looks"] },
    ],
  },

  // ── AI: responsible use and deployment ────────────────────────────────
  {
    title: "AI Ethics & Fairness",
    category: "Responsible AI",
    description: "Who AI hurts, why, and what can be done about it.",
    level: "intermediate",
    modules: [
      { title: "How bias enters a dataset", topic: "bias in training data", subtopics: ["Historical bias recorded as fact", "Labeling bias and annotator disagreement", "Measurement bias from a bad proxy"] },
      { title: "Sampling bias", topic: "sampling bias", subtopics: ["Who is missing from the data", "Coverage versus convenience samples", "When the sample is not the population"] },
      { title: "Fairness metrics", topic: "fairness metrics in machine learning", subtopics: ["Demographic parity", "Equal opportunity", "Measuring each group separately"] },
      { title: "The fairness trade-offs", topic: "the impossibility of fairness", subtopics: ["Why the criteria conflict", "Choosing which harm to reduce", "Deciding who gets to choose"] },
      { title: "Privacy and data protection", topic: "data privacy in machine learning", subtopics: ["What counts as personal data", "Differential privacy", "The right to deletion and its limits"] },
      { title: "Explainability", topic: "explainable ai and interpretability", subtopics: ["Why a decision needs a reason", "SHAP and feature attribution", "Faithful versus plausible explanations"] },
      { title: "Accountability", topic: "accountability for ai decisions", subtopics: ["Who answers when it goes wrong", "Appeals and contestability", "Documentation and audit trails"] },
    ],
  },
  {
    title: "AI Safety & Alignment",
    category: "Responsible AI",
    description: "Making sure increasingly capable systems stay useful and safe.",
    level: "advanced",
    modules: [
      { title: "What alignment means", topic: "ai alignment", subtopics: ["Keeping goals aligned with intent", "Specification versus robust alignment", "Why this is an open problem"] },
      { title: "Specification problems", topic: "the specification problem in ai", subtopics: ["Writing the objective correctly", "Reward hacking", "Goodhart's law in practice"] },
      { title: "Human feedback and RLHF", topic: "human feedback and rlhf", subtopics: ["Learning from human preferences", "Reward modelling and its biases", "Annotator disagreement and alignment tax"] },
      { title: "Interpretability research", topic: "mechanistic interpretability", subtopics: ["Reading features inside a model", "Sparse autoencoders and superposition", "What we still cannot see"] },
      { title: "Red teaming", topic: "red teaming ai models", subtopics: ["Deliberately breaking a system", "Building adversarial test sets", "From finding bugs to fixing them"] },
      { title: "Adversarial examples", topic: "adversarial examples and attacks", subtopics: ["Crafting inputs that fool a model", "Transferability between models", "Defences and their limits"] },
      { title: "Misuse and misuse prevention", topic: "ai misuse and deepfakes", subtopics: ["Disinformation and impersonation", "Watermarking and provenance", "Capability thresholds and access"] },
    ],
  },
  {
    title: "AI in Production",
    category: "Responsible AI",
    description: "Shipping a model, keeping it honest, and keeping it affordable.",
    level: "advanced",
    modules: [
      { title: "From notebook to service", topic: "machine learning operations mlops", subtopics: ["Packaging a model", "Versioning data and weights", "Reproducing a result six months later"] },
      { title: "Model deployment", topic: "deploying machine learning models", subtopics: ["Serving as an API or in-process", "Batching and latency", "Rolling out without a flag day"] },
      { title: "Monitoring in production", topic: "monitoring models in production", subtopics: ["What to log on every prediction", "Latency and error budgets", "Detecting silent failures"] },
      { title: "Model drift", topic: "model drift and data drift", subtopics: ["The world changing underneath the model", "Concept drift versus data drift", "Knowing when to retrain"] },
      { title: "Inference cost and latency", topic: "inference cost and latency", subtopics: ["Cost per call and what drives it", "Quantisation and distillation", "Trading quality for speed"] },
      { title: "Choosing a model", topic: "choosing the right model for a task", subtopics: ["Bigger is not always better", "Latency and capability budgets", "Evaluating against your own data"] },
      { title: "When not to use AI", topic: "when not to use machine learning", subtopics: ["When a rule is better", "Cost of being wrong", "Falling back to a person"] },
    ],
  },
  {
    title: "AI Across Industries",
    category: "Responsible AI",
    description: "Where these techniques land in the real world, domain by domain.",
    level: "intermediate",
    modules: [
      { title: "AI in healthcare", topic: "ai in healthcare", subtopics: ["Imaging and diagnostic support", "Clinical workflow fit", "Liability when it is wrong"] },
      { title: "AI in finance", topic: "ai in finance and banking", subtopics: ["Fraud detection at scale", "Credit scoring and its harms", "Explainability requirements"] },
      { title: "AI in education", topic: "ai in education", subtopics: ["Personalised practice", "Proctoring and surveillance", "Cheating versus tutoring"] },
      { title: "AI in transport", topic: "ai in transport and logistics", subtopics: ["Routing and dispatch", "Demand forecasting", "Predictive maintenance"] },
      { title: "AI in agriculture", topic: "ai in agriculture", subtopics: ["Yield prediction", "Disease detection from leaves", "The field-data problem"] },
      { title: "AI for accessibility", topic: "ai for accessibility", subtopics: ["Speech and captioning", "Vision assistance", "Designing for the users rarely in your data"] },
    ],
  },
];

export default CURRICULUM;

/**
 * Starter courses that were renamed or folded into another course and are no
 * longer part of the curriculum.
 *
 * This is an explicit allowlist on purpose. The seeder inserts and syncs by
 * title, so a course that disappears from CURRICULUM would otherwise linger
 * forever as a ghost — which is exactly what happened to "AI in Practice" when
 * it became "AI in Production", leaving a duplicate stranded in a category
 * nothing else used.
 *
 * Naming the retired titles here means we can only ever delete something
 * somebody deliberately decided to remove. Anything not listed here is left
 * alone forever.
 */
export const RETIRED_COURSE_TITLES: ReadonlySet<string> = new Set([
  "AI in Practice",
]);

